var API = (function(){
  var API_URL = '{{API_URL}}'; /* COLOCA AQUI o URL do backend depois de fazer deploy */
  var base = API_URL !== '{{API_URL}}' ? API_URL : 'http://'+(location.host||'localhost:3000');

  function api(path, opts){
    opts = opts || {};
    return fetch(base+path, {
      method: opts.method || 'GET',
      headers: opts.body ? {'Content-Type':'application/json'} : undefined,
      body: opts.body ? JSON.stringify(opts.body) : undefined
    }).then(function(r){return r.json()}).catch(function(){return {ok:false}});
  }

  // ─── Users ─────────────────────────────────────────

  function login(email, password){
    return api('/api/login', {method:'POST', body:{email,password}});
  }
  function register(name, email, phone, password){
    return api('/api/register', {method:'POST', body:{name,email,phone,password}});
  }
  function resetPassword(email, password){
    return api('/api/reset-password', {method:'POST', body:{email,password}});
  }
  function getUser(email){
    return api('/api/user/'+encodeURIComponent(email));
  }
  function saveAvatar(email, avatar){
    return api('/api/avatar', {method:'POST', body:{email,avatar}});
  }
  function saveAddress(email, province, municipality, neighborhood, street, reference){
    return api('/api/user/address', {method:'PUT', body:{email, province, municipality, neighborhood, street, reference}});
  }

  // ─── Products ──────────────────────────────────────

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

  // ─── Chats ─────────────────────────────────────────

  function getChats(email){
    var q = email ? '?email='+encodeURIComponent(email) : '';
    return api('/api/chats'+q);
  }
  function sendChat(product_id, user_email, from, text, timestamp){
    return api('/api/chats', {method:'POST', body:{product_id, user_email, from, text, timestamp:timestamp||Date.now()}});
  }
  function markChatRead(product_id, user_email, reader_email){
    return api('/api/chats/read', {method:'PUT', body:{product_id, user_email, reader_email: reader_email || user_email}});
  }

  // ─── Cart ──────────────────────────────────────────

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

  return {
    login: login,
    register: register,
    resetPassword: resetPassword,
    getUser: getUser,
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
    clearCart: clearCart
  };
})();
