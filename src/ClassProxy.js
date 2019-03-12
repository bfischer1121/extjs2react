let callCount = 0
let logCall = (...args) => {
    callCount++
    if(callCount > 1000){
        throw 'Failed'
    }

    console.log(...args)
}

const esify = className => {
  return function(...args){
    let ext = new Ext.create(className, ...args)

    return new Proxy(this, {
      get(target, prop, esObject){
        logCall('get from class', prop)
        return typeof target[prop] !== 'undefined' ? target[prop] : ext[prop]
      }
    })
  }
}

const DataModel = esify('Ext.data.Model')
const Store = esify('Ext.data.Store')
const Component = esify('Ext.Component')
const List = esify('Ext.List')
const Button = esify('Ext.Button')

class User extends DataModel{
  static fields = ['id', 'first_name', 'last_name']

  static myMethod(){
    console.log('called es6 method')
  }

  getFullName(){
    return this.get('first_name') + this.get('last_name')
  }
}

class UserList extends List{
  itemTpl = '{first_name}'
}

class UserProfile extends Component{
  tpl = '{first_name} {last_name}'
}

class NewButton extends Button{
  text = 'New User'
  getTe(){}
}

class UserStore extends Store{
  foo = 'bar'
}

console.log({
  staticsProp  : UserStore.$className === 'Ext.data.Store',
  staticMethod : UserStore.addConfig
})

let store = new Store()

console.log({
    store,
  prop   : store.foo,
  method : 'f'
})

//let user = new User({ id: 1, first_name: 'Blake', last_name: 'Fischer' })

console.log({ user, data: user.getData() })

//console.log('ready')
//window.blah = new NewButton({ renderTo: Ext.getBody() })

  /*new UserProfile({
    record   : user,
    renderTo : Ext.getBody()
  })*/

let callCount = 0
let logCall = (...args) => {
  callCount++

  if(callCount > 1000){
    throw 'Failed'
  }

  //console.log(...args)
}

const esify = (() => {
  let proxyDisabled = false

  let createProxy = (object, ext) => (
    new Proxy(object, {
      
      get(target, prop){
        logCall('get', prop, ext[prop])
        return (prop === 'prototype' || proxyDisabled) ? target[prop] : ext[prop]
      },

      set(target, prop, value){
        logCall('set', prop, value)

        if(prop in target){
          target[prop] = value
        }

        ext[prop] = value
        return true
      }
    })
  )

  let createExtClass = (className, cls) => {
    let excludedProps = [...Object.getOwnPropertyNames(Object.getPrototypeOf(cls)), 'constructor']

    let getProps = obj => (
      Object.getOwnPropertyNames(obj)
        .filter(p => !excludedProps.includes(p))
        .reduce((config, prop) => ({ ...config, [prop]: obj[prop] }), {})
    )

    proxyDisabled = true
    let statics  = getProps(cls),
        instance = new cls(),
        configs  = { ...getProps(instance), ...getProps(Object.getPrototypeOf(instance)) }
    proxyDisabled = false

    let ext = Ext.define(null, {
      extend: cls.$extClassName,
      ...(Object.keys(statics).length ? { statics } : {}),
      ...configs
    })

    Ext.ClassManager.setNamespace(className, createProxy(cls, ext))
  }

  return (className, cls) => {
    if(!Ext.ClassManager.get(className)){
      createExtClass(className, cls)
    }

    let constructor = function(...args){
      return createProxy(this, new Ext.create(className, ...args))
    }

    constructor.$extClassName = className

    return constructor
  }
})()

const DataModel = esify('Ext.data.Model')
const Store = esify('Ext.data.Store')
const Component = esify('Ext.Component')
const List = esify('Ext.List')
const Button = esify('Ext.Button')

Ext.define('MyApp.User', {
  extend: 'Ext.data.Model',
  fields: ['id', 'first_name', 'last_name']
})

class UserClass extends DataModel{
  static fields = ['id', 'first_name', 'last_name']

  static myMethod(){
    console.log('called es6 method')
  }

  getFullName(){
    return this.get('first_name') + this.get('last_name')
  }
}

const User = esify('MyApp.OtherUser', UserClass)

console.log({
  ext : MyApp.User.getFields(),
  es  : MyApp.OtherUser.getFields()
})

class UserList extends List{
  itemTpl = '{first_name}'
}

class UserProfile extends Component{
  tpl = '{first_name} {last_name}'
}

class NewButton extends Button{
  text = 'New User'
  getTe(){}
}

class UserStore extends Store{
  foo = 'bar'
}

console.log({
  staticsProp  : UserStore.$className === 'Ext.data.Store',
  staticMethod : UserStore.addConfig
})

let store = new Store()

console.log({
    store,
  prop   : store.foo,
  method : 'f'
})

let user = new User({ id: 1, first_name: 'Blake', last_name: 'Fischer' })
console.log({ user, data: user.getData() })

//console.log('ready')
//window.blah = new NewButton({ renderTo: Ext.getBody() })

  /*new UserProfile({
    record   : user,
    renderTo : Ext.getBody()
  })*/