import { namedTypes as t, visit } from 'ast-types'
import _ from 'lodash'
import { Ast } from './Util'

export const beforeTranspile = codebase => {
  let classes = codebase.sourceFiles.reduce((classes, sourceFile) => ([...classes, ...sourceFile.classes]), [])

  let transforms = {
    '*.app.*' : (node, appName, methodName) => ([`App.${methodName}`])
  }

  transforms = Object.keys(transforms).map(key => ({
    check     : new RegExp('^' + key.replace(/\./g, '\\.').replace(/\*/g, '([^\\.]+)') + '$'),
    transform : transforms[key]
  }))

  classes.forEach(cls => {
    visit(cls._ast, {
      visitCallExpression: function(path){
        let methodName = Ast.getMethodCall(path.node),
            transform  = transforms.find(({ check }) => methodName.match(check))

        if(transform){
          let [newMethodName] = transform.transform(path.node, ...methodName.match(transform.check).slice(1))
          console.log(methodName, newMethodName)
          path.node.callee = Ast.from(newMethodName)
        }

        this.traverse(path)
      }
    })
    
  })
}