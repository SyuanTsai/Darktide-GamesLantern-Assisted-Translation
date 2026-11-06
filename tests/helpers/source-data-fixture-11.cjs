const { fixture } = require('./source-data-fixture.cjs');
function fixture11() {
 const x=fixture(); for (const d of Object.values(x)) d.schemaVersion='1.1.0';
 for (const w of x.weapons.items) { w.values.curves=[]; w.values.attackCombos=[];
  for (const b of w.values.bars) for (const s of b.stats) { s.curveId=b.id+'.'+s.key; w.values.curves.push({id:s.curveId,bar:b.id,stat:s.key,name:s.name,input:{source:'base_stat_value',unit:'ratio',min:0,max:1},interpolation:'linear',knots:[{input:0,output:0},{input:1,output:1}],outputUnit:null,unknown:null,source:{path:'x.lua',line:1}}); }
  w.values.attackCombos.push({id:'light',kind:'light',start:'start',steps:[{action:'hit',input:'light_attack',name:{en:'Strike',zh:'斬擊'},damageProfile:null,damageProfileUnknown:'DYNAMIC_VALUE'}],loopsTo:0,unknown:null,source:{path:'x.lua',line:1}});
 } return x;
}
module.exports={fixture11};
