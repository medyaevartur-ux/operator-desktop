(() => {
  const session={id:'22222222-2222-4222-8222-222222222222',visitor_id:'11111111-1111-4111-8111-111111111111',visitor_name:'Анна',status:'with_operator',operator_name:'Мария',operator_avatar_url:null};
  const messages=[{id:'33333333-3333-4333-8333-333333333333',sender:'operator',message:'Здравствуйте! Поможем выбрать историю для вашего ребёнка.'},{id:'44444444-4444-4444-8444-444444444444',sender:'visitor',message:'А имя ребёнка будет в самой сказке?'},{id:'55555555-5555-4555-8555-555555555555',sender:'operator',message:'Да, ваш ребёнок станет главным героем книги.'}].map(message=>({...message,session_id:session.id,created_at:new Date().toISOString(),is_read:true,status:'read',message_type:'text'}));
  window.__zsPreviewConfig={api_base:location.origin,widget_config:{header_title:'Живая Сказка',color:'#aa5129',theme:'light',header_style:'light',position:'bottom-right',font_family:'system',greeting:'Поможем выбрать сказку',auto_open_delay:0},prechat_form:{enabled:false},business_hours:null,session,messages};
  // The designer can never send messages or read operator data, even when an
  // edited widget configuration points to a different API host.
  window.fetch=async(input,options={})=>{
    const url=new URL(typeof input==='string'?input:input.url,location.href),method=options.method||'GET';
    let result={ok:true};
    if(url.pathname.endsWith('/messages')&&method==='GET')result=messages;
    else if(url.pathname.endsWith('/messages')&&method==='POST'){
      const body=JSON.parse(options.body||'{}');
      result=messages.find(item=>item.client_message_id===body.client_message_id)||{id:crypto.randomUUID(),session_id:session.id,created_at:new Date().toISOString(),sender:'visitor',is_read:false,status:'sent',...body};
      if(!messages.some(item=>item.id===result.id))messages.push(result);
    }else if(url.pathname.includes('/sessions'))result=session;
    else if(url.pathname.endsWith('/team'))result=[{id:'preview',name:'Мария',is_online:true}];
    return new Response(JSON.stringify(result),{status:200,headers:{'content-type':'application/json'}});
  };
  const script=document.createElement('script');script.src='/widget.js';script.onload=()=>parent.postMessage({type:'ZS_PREVIEW_READY'},'*');document.body.appendChild(script);
})();
