# gatsby-source-anyxml

a highly configurable gatsby source plugin for xml resources - still wip

it supports the following graphql scalars:

* Int
* Float
* String
* Boolean
* ID

any other types (like arrays or custom types) can be be used in the schemaType definition in a itemProp but need to be parsed manually using a "parser" func

## example usage

	{
	  resolve: 'gatsby-source-anyxml',
	  options: {
	    sources: [
	      {
	        url: 'https://my-feed.xml',
	        mappings: [
	          {
	            typeName: 'MyGraphQLTypeName',
	            itemSelector: '/xpath/selector/for/items',
	            itemProps: {
	              originalId: {
	                schemaType: 'ID!',
	                selector: 'selector/in/item',
	              },
	              someStaticValue: {
	                schemaType: 'String!',
	                static: 'a-static-value',
	              },
	              parsed: {
	                schemaType: 'Boolean',
	                selector: 'stringybool',
	                parser: (value) => value === 'yes',
	              },
	              myKeywords: {
	                schemaType: '[String!]',
	                selector: 'keywords',
	                parser: (value) => value ? value?.split(',').filter((v) => v.length) : null,
	              },
	              pubDate: {
	                schemaType: 'Date!',
	                schemaDirective: '@dateformat',
	                selector: 'date',
	                parser: (value) => (new Date(Date.parse(value))).toISOString(),
	              },
	            },
	          },
	        ],
	      },
	    ],
	  },
	},