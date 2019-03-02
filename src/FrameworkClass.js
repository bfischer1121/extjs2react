classes = []

code(
  'import { reactify } from \'@extjs/reactor\'',
  '',
  ...(classes.map(cls => `export const ${getExportName(cls)} = reactify('${cls.xtype}')`))
)

getIndexCode(){
  let components = [
    {
      className : 'Button',
      xtype     : 'button',
      props     : [{ name: 'cls', usage: 42 }],
      usage     : 42
    }
  ]

  let longestClassName = Math.max(0, ...components.map(cls => cls.className.length)),
      getComment       = cls => _.repeat(' ', (longestClassName - cls.className.length) * 2) + `// used ${cls.usage} times`

  getComponentCode()

  return code(
    ...components.map(cls => `export { default as ${cls.className} } from './components/${cls.className}' ${getComment(cls)}`)
  )
}
export { default as Button } from './Button' // used 42 times



  `import { ${className} as ExtJS${className} } from 'framework'`,


import { Button as ExtJSButton } from 'framework'

class Button extends Component{
  render(){
    return <ExtJSButton {...props} />
  }
}

getComponentCode({ className, xtype, props }){
  let longestProp = Math.max(0, ...props.map(prop => prop.name.length)),
      getComment  = prop => _.repeat(' ', longestProp - prop.name.length) + `// used ${prop.usage} times`,
      comma       = (array, i, space = true) => i < (array.length - 1) ? ',' : (space ? ' ' : '')

  return code(
    `import { reactify } from '@extjs/reactor'`,
    `const ExtJS${className} = reactify('${xtype}')`,
    '',
    `export default class ${className} extends Component{`,
    [
      'render(){',
      [
        'const {',
          props.sort((p1, p2) => p1.usage - p2.usage).map((prop, i) => (
            `${prop.name}${comma(props, i)} ${getComment(prop)}`
          )),
        '} = this.props',
        '',
        `return <ExtJS${className} {...(this.props)} />`
      ],
      '}'
    ],
    '}'
  )
}