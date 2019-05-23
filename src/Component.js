import _ from 'lodash'

export default class Component{
  this.xtypes = {
    button : 'Button'
  }

  static convert(xtype, config){
    if(!this._instance){
      this._instance = new Component()
    }

    let lib = this._instance.xtypes[xtype]

    if(lib){
      return { lib, cmp: this._instance[xtype] }
    }
  }

  button(config){
    
  }
}