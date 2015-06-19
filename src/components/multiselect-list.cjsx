_ = require 'underscore'
React = require 'react'
classNames = require 'classnames'
ListTabular = require './list-tabular'
Spinner = require './spinner'
{Actions,
 Utils,
 WorkspaceStore,
 FocusedContentStore,
 NamespaceStore} = require 'nylas-exports'
EventEmitter = require('events').EventEmitter

MultiselectListInteractionHandler = require './multiselect-list-interaction-handler'
MultiselectSplitInteractionHandler = require './multiselect-split-interaction-handler'

###
Public: MultiselectList wraps {ListTabular} and makes it easy to present a
{ModelView} with selection support. It adds a checkbox column to the columns
you provide, and also handles:

- Command-clicking individual items
- Shift-clicking to select a range
- Using the keyboard to select a range

Section: Component Kit
###
class MultiselectList extends React.Component
  @displayName = 'MultiselectList'

  @propTypes =
    className: React.PropTypes.string.isRequired
    collection: React.PropTypes.string.isRequired
    commands: React.PropTypes.object.isRequired
    columns: React.PropTypes.array.isRequired
    dataStore: React.PropTypes.object.isRequired
    itemPropsProvider: React.PropTypes.func.isRequired
    itemHeight: React.PropTypes.number.isRequired
    scrollTooltipComponent: React.PropTypes.func
    emptyComponent: React.PropTypes.func

  constructor: (@props) ->
    @state = @_getStateFromStores()

  componentDidMount: =>
    @setupForProps(@props)

  componentWillReceiveProps: (newProps) =>
    return if _.isEqual(@props, newProps)
    @teardownForProps()
    @setupForProps(newProps)
    @setState(@_getStateFromStores(newProps))

  componentDidUpdate: (prevProps, prevState) =>
    if prevState.focusedId isnt @state.focusedId or
       prevState.keyboardCursorId isnt @state.keyboardCursorId

      item = React.findDOMNode(@).querySelector(".focused")
      item ?= React.findDOMNode(@).querySelector(".keyboard-cursor")
      @refs.list.scrollTo(item)

  componentWillUnmount: =>
    @teardownForProps()

  teardownForProps: =>
    return unless @unsubscribers
    unsubscribe() for unsubscribe in @unsubscribers
    @command_unsubscriber.dispose()

  setupForProps: (props) =>
    commands = _.extend {},
      'core:focus-item': => @_onEnter()
      'core:select-item': => @_onSelect()
      'core:next-item': => @_onShift(1)
      'core:previous-item': => @_onShift(-1)
      'core:select-down': => @_onShift(1, {select: true})
      'core:select-up': => @_onShift(-1, {select: true})
      'application:pop-sheet': => @_onDeselect()

    Object.keys(props.commands).forEach (key) =>
      commands[key] = =>
        context = {focusedId: @state.focusedId}
        props.commands[key](context)

    @unsubscribers = []
    @unsubscribers.push props.dataStore.listen @_onChange
    @unsubscribers.push WorkspaceStore.listen @_onChange
    @unsubscribers.push FocusedContentStore.listen @_onChange
    @command_unsubscriber = atom.commands.add('body', commands)

  render: =>
    # IMPORTANT: DO NOT pass inline functions as props. _.isEqual thinks these
    # are "different", and will re-render everything. Instead, declare them with ?=,
    # pass a reference. (Alternatively, ignore these in children's shouldComponentUpdate.)
    #
    # BAD:   onSelect={ (item) -> Actions.focusThread(item) }
    # GOOD:  onSelect={@_onSelectItem}
    #
    className = @props.className
    className += " ready" if @state.ready

    if @state.dataView and @state.handler
      className += " " + @state.handler.cssClass()

      @itemPropsProvider ?= (item) =>
        props = @props.itemPropsProvider(item)
        props.className ?= ''
        props.className += " " + classNames
          'selected': item.id in @state.selectedIds
          'focused': @state.handler.shouldShowFocus() and item.id is @state.focusedId
          'keyboard-cursor': @state.handler.shouldShowKeyboardCursor() and item.id is @state.keyboardCursorId
        props

      emptyElement = []
      if @props.emptyComponent
        emptyElement = <@props.emptyComponent
          visible={@state.ready && @state.dataView.count() is 0}
          dataView={@state.dataView} />

      <div className={className}>
        <ListTabular
          ref="list"
          columns={@state.computedColumns}
          scrollTooltipComponent={@props.scrollTooltipComponent}
          dataView={@state.dataView}
          itemPropsProvider={@itemPropsProvider}
          itemHeight={@props.itemHeight}
          onSelect={@_onClickItem}
          onDoubleClick={@props.onDoubleClick} />
        <Spinner visible={!@state.ready} />
        {emptyElement}
      </div>
    else
      <div className={className}>
        <Spinner visible={@state.ready is false} />
      </div>

  _onClickItem: (item, event) =>
    if event.metaKey
      @state.handler.onMetaClick(item)
    else if event.shiftKey
      @state.handler.onShiftClick(item)
    else
      @state.handler.onClick(item)

  _onEnter: =>
    @state.handler.onEnter()

  _onSelect: =>
    @state.handler.onSelect()

  _onDeselect: =>
    return unless @_visible()
    @state.dataView.selection.clear()

  _onShift: (delta, options = {}) =>
    @state.handler.onShift(delta, options)

  _onChange: =>
    @setState(@_getStateFromStores())

  _visible: =>
    if @state.layoutMode
      WorkspaceStore.topSheet().root
    else
      true

  _getCheckmarkColumn: =>
    new ListTabular.Column
      name: 'Check'
      resolver: (item) =>
        toggle = (event) =>
          if event.shiftKey
            @state.handler.onShiftClick(item)
          else
            @state.handler.onMetaClick(item)
          event.stopPropagation()
        <div className="checkmark" onClick={toggle}><div className="inner"></div></div>

  _getStateFromStores: (props) =>
    props ?= @props
    state = @state ? {}

    layoutMode = WorkspaceStore.layoutMode()
    view = props.dataStore?.view()
    return {} unless view

    # Do we need to re-compute columns? Don't do this unless we really have to,
    # it will cause a re-render of the entire ListTabular. To know whether our
    # computed columns are still valid, we store the original columns in our state
    # along with the computed ones.
    if props.columns isnt state.columns or layoutMode isnt state.layoutMode
      computedColumns = [].concat(props.columns)
      if layoutMode is 'list'
        computedColumns.splice(0, 0, @_getCheckmarkColumn())
    else
      computedColumns = state.computedColumns

    if layoutMode is 'list'
      handler = new MultiselectListInteractionHandler(view, props.collection)
    else
      handler = new MultiselectSplitInteractionHandler(view, props.collection)

    dataView: view
    handler: handler
    ready: view.loaded()
    columns: props.columns
    computedColumns: computedColumns
    layoutMode: layoutMode
    selectedIds: view.selection.ids()
    focusedId: FocusedContentStore.focusedId(props.collection)
    keyboardCursorId: FocusedContentStore.keyboardCursorId(props.collection)

module.exports = MultiselectList
