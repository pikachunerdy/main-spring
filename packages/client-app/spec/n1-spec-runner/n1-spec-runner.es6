/* eslint global-require:0 */
import _ from 'underscore';

import ReactTestUtils from 'react-dom/test-utils';
import Config from '../../src/config'
import N1SpecLoader from './n1-spec-loader'
import TimeReporter from './time-reporter'
import N1GuiReporter from './n1-gui-reporter';
import jasmineExports from './jasmine';
import ConsoleReporter from './console-reporter'
import MasterAfterEach from './master-after-each'
import MasterBeforeEach from './master-before-each'
import nylasTestConstants from './nylas-test-constants'
import * as jasmineExtensions from './jasmine-extensions'
import * as reactTestUtilsExtensions from './react-test-utils-extensions'

class N1SpecRunner {
  runSpecs(loadSettings) {
    this.loadSettings = loadSettings
    this._extendGlobalWindow();
    this._setupJasmine();
    this._setupNylasEnv();
    this._setupWindow();
    Object.assign(ReactTestUtils, reactTestUtilsExtensions)
    MasterBeforeEach.setup(this.loadSettings, window.beforeEach)
    MasterAfterEach.setup(this.loadSettings, window.afterEach)
    N1SpecLoader.loadSpecs(this.loadSettings, this.jasmineEnv);
    this.jasmineEnv.execute();
  }

  /**
   * Put jasmine methods on the global scope so they can be used anywhere
   * without importing jasmine.
   */
  _extendGlobalWindow() {
    Object.assign(window, {
      jasmine: jasmineExports.jasmine,

      it: this._makeItAsync(jasmineExports.it),
      // it: jasmineExports.it,
      fit: this._makeItAsync(jasmineExports.fit),
      xit: jasmineExports.xit,
      runs: jasmineExports.runs,
      waits: jasmineExports.waits,
      spyOn: jasmineExports.spyOn,
      expect: jasmineExports.expect,
      waitsFor: jasmineExports.waitsFor,
      describe: jasmineExports.describe,
      xdescribe: jasmineExports.xdescribe,
      afterEach: this._makeSurroundAsync(jasmineExports.afterEach),
      beforeEach: this._makeSurroundAsync(jasmineExports.beforeEach),
      testNowMoment: jasmineExtensions.testNowMoment,
      waitsForPromise: jasmineExtensions.waitsForPromise,
    }, nylasTestConstants)

    this.jasmineEnv = jasmineExports.jasmine.getEnv();
  }


  _runAsync(userFn) {
    if (!userFn) return true
    const resp = userFn.apply(this);
    if (resp && resp.then) {
      return jasmineExtensions.waitsForPromise(() => {
        return resp
      })
    }
    return resp
  }

  _makeItAsync(jasmineIt) {
    const self = this;
    return (desc, userFn) => {
      return jasmineIt(desc, function asyncIt() {
        self._runAsync.call(this, userFn)
      })
    }
  }

  _makeSurroundAsync(jasmineBeforeAfter) {
    const self = this;
    return (userFn) => {
      return jasmineBeforeAfter(function asyncBeforeAfter() {
        self._runAsync.call(this, userFn)
      })
    }
  }

  _setupJasmine() {
    this._addReporters()
    this._initializeDOM()
    this._extendJasmineMethods();

    // On load, this will require "jasmine-focused" which looks up the
    // global `jasmine` object and extends onto it:
    // fdescribe, ffdescribe, fffdescribe, fit, ffit, fffit
    require('jasmine-tagged');

    // On load this will extend jasmine's `beforeEach`
    require('jasmine-json');
  }

  _setupNylasEnv() {
    // We need to mock the config even before `beforeEach` runs because it
    // gets accessed on module definitions
    const fakePersistedConfig = {env: 'production'};
    NylasEnv.config = new Config();
    NylasEnv.config.settings = fakePersistedConfig;

    NylasEnv.restoreWindowDimensions();
    NylasEnv.themes.loadBaseStylesheets();
    NylasEnv.themes.requireStylesheet('../../static/jasmine');
    NylasEnv.themes.initialLoadComplete = true;
    NylasEnv.keymaps.loadKeymaps();
  }

  _setupWindow() {
    window.addEventListener('core:close', () => window.close());
    window.addEventListener('beforeunload', () => {
      NylasEnv.storeWindowDimensions();
      return NylasEnv.saveSync();
    });

    // On load this will extend the window object
    require('../../src/window');
  }

  _addReporters() {
    const timeReporter = new TimeReporter();
    const consoleReporter = new ConsoleReporter();

    const loadSettings = NylasEnv.getLoadSettings();

    if (loadSettings.jUnitXmlPath) {
      // jasmine-reporters extends the jasmine global with methods, so needs to
      // be `required` at runtime. The `jasmine` object has to be attached to the
      // global scope before it gets extended. This is done in
      // `_extendGlobalWindow`
      require('jasmine-reporters');
      const jUnitXmlReporter = new jasmine.JUnitXmlReporter(loadSettings.jUnitXmlPath, true, true);
      this.jasmineEnv.addReporter(jUnitXmlReporter);
    }
    this.jasmineEnv.addReporter(timeReporter);
    this.jasmineEnv.addReporter(consoleReporter);

    if (loadSettings.showSpecsInWindow) {
      this.jasmineEnv.addReporter(N1GuiReporter);
      NylasEnv.show();
    } else {
      // this package's dep `jasmine-focused` also adds methods to the
      // `jasmine` global
      // NOTE: this reporter MUST be added last as it exits the test process
      // when complete, which may result in e.g. your XML output not getting
      // written to disk if that reporter is added afterward.
      const N1TerminalReporter = require('./terminal-reporter').default

      const terminalReporter = new N1TerminalReporter();
      this.jasmineEnv.addReporter(terminalReporter);
    }
  }

  _initializeDOM() {
    const div = document.createElement('div');
    div.id = 'jasmine-content';
    document.body.appendChild(div);
    document.querySelector('html').style.overflow = 'initial';
    document.querySelector('body').style.overflow = 'initial';
    document.getElementById("application-loading-cover").remove();
  }

  _extendJasmineMethods() {
    const jasmine = jasmineExports.jasmine;

    // Use underscore's definition of equality for toEqual assertions
    jasmine.getEnv().addEqualityTester(_.isEqual);

    jasmine.unspy = jasmineExtensions.unspy
    jasmine.attachToDOM = jasmineExtensions.attachToDOM

    const origEmitObject = jasmine.StringPrettyPrinter.prototype.emitObject;
    jasmine.StringPrettyPrinter.prototype.emitObject = function emitObject(obj) {
      if (obj.inspect) {
        return this.append(obj.inspect());
      }
      return origEmitObject.call(this, obj);
    };
  }
}
export default new N1SpecRunner()
