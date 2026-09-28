export function createDemo() {
  const plans = [
    {id:'plan-1',name:'Inicial',monthly_messages:1000,max_members:3,whatsapp:true,description:'Lo esencial para comenzar'},
    {id:'plan-2',name:'Profesional',monthly_messages:10000,max_members:10,whatsapp:true,description:'Más capacidad para tu equipo'},
    {id:'plan-3',name:'Empresa',monthly_messages:50000,max_members:50,whatsapp:true,description:'Para una operación de mayor escala'}
  ];
  const workspaces = [
    {id:'demo-1',name:'Estudio Oliva',industry:'Diseño e interiores',contact_email:'hola@example.com',plan_id:'plan-2',status:'active',created_at:new Date().toISOString()},
    {id:'demo-2',name:'Café Central',industry:'Alimentos y bebidas',contact_email:'cafe@example.com',plan_id:'plan-1',status:'active',created_at:new Date().toISOString()}
  ];
  const details = {};
  for (const [index,w] of workspaces.entries()) {
    const messages = Array.from({length:index ? 12 : 82},(_,i)=>({
      id:`sample-${index}-${i}`,workspace_id:w.id,phone:['525500000001','525500000002','525500000003'][i%3],
      content:i%3===0?'Hola, me gustaría conocer más sobre sus servicios.':i%3===1?'¡Hola! Gracias por escribirnos. Con gusto te ayudamos.':'Tu cita está confirmada. Nos vemos pronto.',
      direction:i%3===0?'inbound':'outbound',kind:'text',status:i%3===0?'received':i%4===0?'delivered':'read',created_at:new Date(Date.now()-i*7100000).toISOString()
    }));
    details[w.id] = {
      messages,usage:index ? 126:428,inbound:index ? 31:186,role:'owner',
      members:[{user_id:'demo-user',email:'ana@example.com',role:'owner'},{user_id:'demo-agent',email:'diego@example.com',role:'agent'}],
      connection:index ? null:{phone_number_id:'123456789',waba_id:'987654321',display_phone:'+52 55 0000 0000',verified_name:'Estudio Oliva',connected_at:new Date().toISOString()},
      activity:[{id:1,description:'Credenciales de WhatsApp verificadas y guardadas',created_at:new Date(Date.now()-3600000).toISOString()},{id:2,description:'Acceso actualizado: diego@example.com',created_at:new Date(Date.now()-86400000).toISOString()},{id:3,description:'Negocio creado',created_at:new Date(Date.now()-172800000).toISOString()}]
    };
  }
  return {plans,workspaces,details};
}
