import Model from './model'
import Attributes from '../attributes'

/**
 Cloud-persisted data that is associated with a single Nylas API object
 (like a `Thread`, `Message`, or `Account`).
 */
class PluginMetadata extends Model {
  static attributes = {
    pluginId: Attributes.String({
      modelKey: 'pluginId',
    }),
    version: Attributes.Number({
      jsonKey: 'v',
      modelKey: 'version',
    }),
    value: Attributes.Object({
      modelKey: 'value',
    }),
  };

  constructor(...args) {
    super(...args)
    this.version = this.version || 0;
  }

  get id() {
    return this.pluginId
  }

  set id(pluginId) {
    this.pluginId = pluginId
  }
}


/**
 Plugins can attach arbitrary JSON data to any model that subclasses
 ModelWithMetadata, like {{Thread}} or {{Message}}. You must get and set
 metadata using your plugin's ID, and any metadata you set overwrites the
 metadata previously on the object for the given plugin id.

 Reading the metadata of other plugins is discouraged and may become impossible
 in the future.
*/
export default class ModelWithMetadata extends Model {
  static attributes = Object.assign({}, Model.attributes, {
    pluginMetadata: Attributes.Collection({
      queryable: true,
      itemClass: PluginMetadata,
      joinOnField: 'pluginId',
      joinTableName: 'ModelPluginMetadata',
      modelKey: 'pluginMetadata',
      jsonKey: 'metadata',
    }),
  });

  static naturalSortOrder() {
    return null
  }

  constructor(...args) {
    super(...args)
    this.pluginMetadata = this.pluginMetadata || [];
  }

  // Public accessors

  metadataForPluginId(pluginId) {
    const metadata = this.metadataObjectForPluginId(pluginId);
    if (!metadata) {
      return null;
    }
    const m = JSON.parse(JSON.stringify(metadata.value));
    if (m.expiration) {
      m.expiration = new Date(m.expiration * 1000);
    }
    return m;
  }

  // Private helpers

  metadataObjectForPluginId(pluginId) {
    if (typeof pluginId !== "string") {
      throw new Error(`Invalid pluginId. Must be a valid string: '${pluginId}'`, pluginId)
    }
    return this.pluginMetadata.find(metadata => metadata.pluginId === pluginId);
  }

  applyPluginMetadata(pluginId, metadataValue) {
    let metadata = this.metadataObjectForPluginId(pluginId);
    if (!metadata) {
      metadata = new PluginMetadata({pluginId});
      this.pluginMetadata.push(metadata);
    }
    metadata.value = Object.assign({}, metadataValue);
    if (metadata.value.expiration) {
      metadata.value.expiration = Math.round(new Date(metadata.value.expiration).getTime() / 1000);
    }
    return this;
  }

  clonePluginMetadataFrom(otherModel) {
    this.pluginMetadata = otherModel.pluginMetadata.map(({pluginId, value}) => {
      return new PluginMetadata({pluginId, value});
    })
    return this;
  }
}
