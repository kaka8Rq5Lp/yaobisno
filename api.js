var API = (function(){
  /* '' = usa o MESMO dominio (frontend e backend no mesmo serviço Render/local).
     Para outro dominio, preenche ex: 'https://yaobisno.onrender.com' */
  var API_URL = '';
  var base = API_URL || (window.location && window.location.origin) || 'http://localhost:3000';

  var tokenKey = 'yabisno_token';
  function getToken(){ try{return localStorage.getItem(tokenKey)||''}catch(e){return ''} }
  function setToken(t){ try{ if(t) localStorage.setItem(tokenKey,t); else localStorage.removeItem(tokenKey); }catch(e){} }
  function setTokenKey(k){ if(k) tokenKey = k; return tokenKey; }

  function api(path, opts){
    opts = opts || {};
    var headers = {};
    if (opts.body) headers['Content-Type'] = 'application/json';
    var tok = getToken();
    if (tok) headers['Authorization'] = 'Bearer ' + tok;
    return fetch(base+path, {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined
    }).then(function(r){
      return r.json().catch(function(){ return {}; }).then(function(data){
        data._status = r.status;
        return data;
      });
    }).catch(function(){
      return {ok:false, error:'Sem ligação ao servidor'};
    });
  }

  // ─── Auth ─────────────────────────────────────────────

  function login(email, password){
    return api('/api/login', {method:'POST', body:{email,password}}).then(function(r){
      if(r.ok&&r.token)setToken(r.token);
      return r;
    });
  }
  function register(name, email, phone, password){
    return api('/api/register', {method:'POST', body:{name,email,phone,password}}).then(function(r){
      if(r.ok&&r.token)setToken(r.token);
      return r;
    });
  }
  function forgotPassword(email){
    return api('/api/forgot-password', {method:'POST', body:{email}});
  }
  function resetPassword(email, code, password){
    return api('/api/reset-password', {method:'POST', body:{email, code, password}});
  }
  function changePassword(currentPassword, newPassword){
    return api('/api/change-password', {method:'POST', body:{currentPassword, newPassword}});
  }
  function testEmail(to){
    return api('/api/test-email', {method:'POST', body:{to}});
  }
  function getUser(email){
    return api('/api/user/'+encodeURIComponent(email));
  }
  function getProfile(email){
    return api('/api/profile/'+encodeURIComponent(email));
  }
  function saveAvatar(email, avatar){
    return api('/api/avatar', {method:'POST', body:{email,avatar}});
  }
  function saveAddress(email, province, municipality, neighborhood, street, reference){
    return api('/api/user/address', {method:'PUT', body:{email, province, municipality, neighborhood, street, reference}});
  }
  function savePhone(email, phone){
    return api('/api/user/phone', {method:'PUT', body:{email, phone}});
  }

  // ─── Products ──────────────────────────────────────────────

  function getProducts(){
    return api('/api/products');
  }
  function saveProduct(data){
    return api('/api/products', {method:'POST', body:data});
  }
  function updateProduct(id, data){
    return api('/api/products/'+id, {method:'PUT', body:data});
  }
  function deleteProduct(id){
    return api('/api/products/'+id, {method:'DELETE'});
  }

  // ─── Chats ─────────────────────────────────────────────────

  function getChats(email){
    return api('/api/chats');
  }
  function sendChat(product_id, user_email, from, text, timestamp){
    return api('/api/chats', {method:'POST', body:{product_id, user_email, from, text, timestamp:timestamp||Date.now()}});
  }
  function markChatRead(product_id, user_email, reader_email){
    return api('/api/chats/read', {method:'PUT', body:{product_id, user_email, reader_email: reader_email || user_email}});
  }

  // ─── Cart ──────────────────────────────────────────────────

  function getCart(email){
    return api('/api/cart/'+encodeURIComponent(email));
  }
  function addToCart(user_email, product_id){
    return api('/api/cart', {method:'POST', body:{user_email, product_id}});
  }
  function changeCartQty(user_email, product_id, delta){
    return api('/api/cart/qty', {method:'PUT', body:{user_email, product_id, delta}});
  }
  function removeFromCart(user_email, product_id){
    return api('/api/cart', {method:'DELETE', body:{user_email, product_id}});
  }
  function clearCart(email){
    return api('/api/cart/all/'+encodeURIComponent(email), {method:'DELETE'});
  }

  // ─── Payments (Multicaixa Express) ───────────────────────────

  function createPayment(data){
    return api('/api/payment/create', {method:'POST', body:data});
  }
  function getPayment(ref){
    return api('/api/payment/'+encodeURIComponent(ref));
  }
  function refreshPayment(ref){
    return api('/api/payment/'+encodeURIComponent(ref)+'/refresh');
  }
  function recordWhatsappOrder(data){
    return api('/api/sales/whatsapp', {method:'POST', body:data});
  }
  function getSale(ref){
    return api('/api/sale/'+encodeURIComponent(ref));
  }
  function sendComprovativo(ref, image, texto){
    return api('/api/sales/'+encodeURIComponent(ref)+'/comprovativo', {method:'POST', body:{image:image, texto:texto||''}});
  }
  function getSettings(){
    return api('/api/settings');
  }
  function saveSettings(data){
    return api('/api/admin/settings', {method:'PUT', body:data});
  }

  // ─── Admin (painel separado) ──────────────────────────────────────

  function adminLogin(email, password){
    return api('/api/admin/login', {method:'POST', body:{email,password}}).then(function(r){
      if(r.ok&&r.token)setToken(r.token);
      return r;
    });
  }
  function adminMe(){
    return api('/api/admin/me');
  }
  function listAdmins(){
    return api('/api/admin/admins');
  }
  function createAdmin(data){
    return api('/api/admin/admins', {method:'POST', body:data});
  }
  function changeAdminPassword(data){
    return api('/api/admin/password', {method:'PUT', body:data});
  }
  function adminForgotPassword(email){
    return api('/api/admin/forgot-password', {method:'POST', body:{email}});
  }
  function adminResetPassword(email, code, password){
    return api('/api/admin/reset-password', {method:'POST', body:{email, code, password}});
  }
  function deleteAdmin(email){
    return api('/api/admin/admins/'+encodeURIComponent(email), {method:'DELETE'});
  }

  return {
    setTokenKey: setTokenKey,
    login: login,
    register: register,
    forgotPassword: forgotPassword,
    resetPassword: resetPassword,
    changePassword: changePassword,
    testEmail: testEmail,
    getUser: getUser,
    getProfile: getProfile,
    saveAvatar: saveAvatar,
    saveAddress: saveAddress,
    getProducts: getProducts,
    saveProduct: saveProduct,
    updateProduct: updateProduct,
    deleteProduct: deleteProduct,
    getChats: getChats,
    sendChat: sendChat,
    markChatRead: markChatRead,
    getCart: getCart,
    addToCart: addToCart,
    changeCartQty: changeCartQty,
    removeFromCart: removeFromCart,
    clearCart: clearCart,
    createPayment: createPayment,
    getPayment: getPayment,
    refreshPayment: refreshPayment,
    recordWhatsappOrder: recordWhatsappOrder,
    getSale: getSale,
    sendComprovativo: sendComprovativo,
    getSettings: getSettings,
    saveSettings: saveSettings,
    adminLogin: adminLogin,
    adminMe: adminMe,
    listAdmins: listAdmins,
    createAdmin: createAdmin,
    changeAdminPassword: changeAdminPassword,
    adminForgotPassword: adminForgotPassword,
    adminResetPassword: adminResetPassword,
    deleteAdmin: deleteAdmin
  };
})();