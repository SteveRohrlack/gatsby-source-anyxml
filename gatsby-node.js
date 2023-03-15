const xpath = require('xpath');
const dom = require('xmldom').DOMParser;

// todo: needs better error handling
async function getXmlSource(url, { cache }) {
  const cacheEntry = await cache.get(url);
  if (cacheEntry) {
    return cacheEntry;
  }

  const res = await fetch(url);

  if (!res.ok || res.status !== 200) {
    return undefined;
  }

  const documentBody = await res.text();

  await cache.set(url, documentBody);

  return documentBody;
}

function parseItemPropValue(
  {
    schemaType,
    selector,
    static: staticValue,
    parser = (v) => v,
  },
  item,
) {
  let value;

  // the item prop mapping may contain a selector
  if (selector) {
    // namespaces may be defined in any parent node: go get em all
    let namespaces = { ...item._nsMap };
    let parent = item.parentNode;
    while (parent) {
      namespaces = {
        ...namespaces,
        ...parent._nsMap,
      };
      parent = parent.parentNode;
    }

    // it's necessary to set the available namespaces, selecting a namespaced xpath will fail otherwise
    const xpathSelect = xpath.useNamespaces(namespaces);
    // xml is text-based which means everything is a string: explicitly select a string value
    const selection = xpathSelect(`string(${selector})`, item, true);
    // run custom parser
    value = parser(selection);
  }

  // instead of a selector, the value of a field may be static
  if (staticValue) {
    value = staticValue;
  }

  if (value == null) {
    return null;
  }

  switch (schemaType.replace('!', '')) {
    case 'Boolean':
      return !!value;
    case 'Int':
      return parseInt(value, 10);
    case 'Float':
      return parseFloat(value);
    // case 'ID':
    // case 'String':
    // any other types, including arrays
    default:
      return value;
  }
}

// a source needs to have an url and at least one mapping
const filterSource = ({ url, mappings }) => !!(url?.length && mappings?.length);

exports.sourceNodes = async (
  api,
  {
    sources = [],
  },
) => {
  const { reporter } = api;
  const activity = reporter.activityTimer('[gatsby-source-anyxml]');
  activity.start();

  // filter and load sources
  activity.setStatus('loading sources');

  const loadedSources = await Promise.all(
    sources
      .filter(filterSource)
      // add parsed xml "document" to the source
      .map(async ({
        url,
        ...source
      }) => {
        const documentBody = await getXmlSource(url, api);
        if (!documentBody) {
          reporter.warn(`[gatsby-source-anyxml] source "${url}" could not be loaded`);
          return undefined;
        }

        // parse the document body
        const document = new dom().parseFromString(documentBody);
        // idk why errors are communicated like that, it hurts my brain
        const hasParseError = !document || !!document.getElementsByTagName('parsererror').length;
        if (hasParseError) {
          reporter.warn(`[gatsby-source-anyxml] source "${url}" could not be parsed`);
          return undefined;
        }

        return {
          ...source,
          url,
          document,
        };
      })
      // filter empty results
      .filter((source) => !!source)
  );

  // map sources into a flat array of nodes
  activity.setStatus('converting');

  const nodeDefinitions = loadedSources.flatMap(({
    document,
    url,
    mappings,
  }) => mappings.flatMap(({
    typeName,
    itemSelector,
    itemProps,
  }) => {
    // try and select all items in the document by the given selector
    const items = xpath.select(itemSelector, document.documentElement);

    // apply the property mapping to each item
    return items.map((item, index) => {

      const props = Object.keys(itemProps).reduce((carry, key) => {
        const propMapping = itemProps[key];

        const propValue = parseItemPropValue(propMapping, item);
        if (propValue == null && propMapping.schemaType.includes('!')) {
          reporter.warn(`[gatsby-source-anyxml] source "${url}" item ${index+1} property ${key} value is required but was found empty`);
          return carry;
        }

        return {
          ...carry,
          [key]: propValue,
        };
      }, {});

      return {
        typeName,
        props,
      };
    });
  }));

  // create nodes from definitions
  activity.setStatus('creating nodes');

  const {
    actions: {
      createNode,
    },
    createContentDigest,
    createNodeId,
  } = api;

  nodeDefinitions.forEach(({ typeName, props }) => {
    createNode({
      ...props,
      id: createNodeId(`typeName-${JSON.stringify(props)}`),
      internal: {
        type: typeName,
        contentDigest: createContentDigest(props),
      },
    });
  });
};

exports.createSchemaCustomization = async (
  {
    actions: {
      createTypes,
    }
  },
  {
    sources = [],
  },
) => {
  const types = sources
    .filter(filterSource)
    .flatMap(({ mappings }) =>
      mappings.map(({ typeName, itemProps }) => {
        const fields = Object.keys(itemProps).map((key) => {
          const {
            schemaType,
            schemaDirective = '',
          } = itemProps[key];

          return `${key}: ${schemaType} ${schemaDirective}`;
        }).join('\n');

        return `type ${typeName} implements Node { ${fields} }`;
      })
    );

  createTypes(types);
};
