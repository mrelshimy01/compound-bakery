const CONFIG = {
  // Paste the deployed Google Apps Script /exec URL here.
  API_URL: "https://script.google.com/macros/s/AKfycbx2Vkfpsnk-wtYUMF9aky7PySvinXXvWcWweRJVhoeFiGWG5thyoVL6H1elqHAnEq3Eww/exec",
  DEMO_MODE: false,
  DELIVERY_FEE: 5,
  DELIVERY_SLOTS: [
    "8:00–10:00 AM",
    "10:00 AM–12:00 PM",
    "12:00–2:00 PM",
    "2:00–4:00 PM"
  ]
};

const fallbackProducts = [
  {id:1,name:"Baladi Bread",category:"Bread",price:3,emoji:"🥖",active:true},
  {id:2,name:"Brown Bread",category:"Bread",price:5,emoji:"🍞",active:true},
  {id:3,name:"Fino",category:"Bread",price:4,emoji:"🥖",active:true},
  {id:4,name:"Croissant",category:"Pastries",price:25,emoji:"🥐",active:true}
];

let products = [];
let cart = JSON.parse(localStorage.getItem("mb_cart") || "[]");
let customer = JSON.parse(localStorage.getItem("mb_customer") || "null");
let activeOrders = JSON.parse(localStorage.getItem("mb_active_orders") || "[]");
let selectedSlot = "";
let deferredInstallPrompt = null;

const $ = id => document.getElementById(id);

function money(n) {
  return `${Number(n).toFixed(2).replace(/\.00$/, "")} EGP`;
}

function cartSubtotal() {
  return cart.reduce((sum, item) =>
    sum + Number(item.price) * Number(item.qty), 0
  );
}

function orderTotalWithDelivery(subtotal) {
  return Number(subtotal) + Number(CONFIG.DELIVERY_FEE || 0);
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  })[c]);
}

function toast(t) {
  $("toast").textContent = t;
  $("toast").classList.add("show");
  setTimeout(() => $("toast").classList.remove("show"), 2200);
}

function show(id) {
  document.querySelectorAll(".screen").forEach(x => x.classList.remove("active"));
  $(id).classList.add("active");
  window.scrollTo(0, 0);
}

function saveCart() {
  localStorage.setItem("mb_cart", JSON.stringify(cart));
  updateCartBadges();
}

function saveOrders() {
  localStorage.setItem("mb_active_orders", JSON.stringify(activeOrders));
  updateOrdersBadge();
}

function updateCartBadges() {
  const n = cart.reduce((s,x) => s + Number(x.qty), 0);
  $("cartBadge").textContent = n;
  $("menuBadge").textContent = n;
}

function updateOrdersBadge() {
  const n = activeOrders.filter(o => o.status === "Active").length;
  $("ordersBadge").textContent = n;
}

function isCancellationOpen() {
  const now = new Date();
  const cutoff = new Date();
  cutoff.setHours(22,0,0,0);
  return now < cutoff;
}


/* =========================
   DIRECT APP INSTALL
========================= */
function isIOS(){
  return /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform==="MacIntel" && navigator.maxTouchPoints>1);
}
function isAndroid(){ return /android/i.test(navigator.userAgent); }
function isStandalone(){
  return window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone===true;
}
function setupInstallCTA(){
  const btn=$("installAppBtn"), hint=$("installHint"), title=$("installTitle");
  if(!btn)return;
  if(isStandalone()){btn.classList.add("installed");return;}
  if(isIOS()){title.textContent="Install MoharamBake";hint.textContent="Add it to your iPhone Home Screen";}
  else if(isAndroid()){title.textContent="Install MoharamBake";hint.textContent="Install the app on your Android phone";}
  else{hint.textContent="Install the app on your phone";}
  btn.onclick=async()=>{
    if(deferredInstallPrompt){
      deferredInstallPrompt.prompt();
      const result=await deferredInstallPrompt.userChoice;
      deferredInstallPrompt=null;
      if(result&&result.outcome==="accepted")btn.classList.add("installed");
      return;
    }
    if(isIOS()){$("iosInstallModal").hidden=false;return;}
    toast("Open your browser menu and choose Install app.");
  };
}
function setupInstallPrompt(){
  window.addEventListener("beforeinstallprompt",event=>{
    event.preventDefault();deferredInstallPrompt=event;setupInstallCTA();
  });
  window.addEventListener("appinstalled",()=>{
    deferredInstallPrompt=null;
    const btn=$("installAppBtn");if(btn)btn.classList.add("installed");
  });
  const close=$("closeInstallModal"),done=$("iosDone");
  if(close)close.onclick=()=>$("iosInstallModal").hidden=true;
  if(done)done.onclick=()=>$("iosInstallModal").hidden=true;
  setupInstallCTA();
}

function renderCats() {
  const cats = ["All", ...new Set(products.map(p => p.category).filter(Boolean))];
  $("cats").innerHTML = cats.map((c,i) =>
    `<button class="chip ${i===0?"active":""}" data-cat="${esc(c)}">${esc(c)}</button>`
  ).join("");

  document.querySelectorAll(".chip").forEach(b => {
    b.onclick = () => {
      document.querySelectorAll(".chip").forEach(x => x.classList.remove("active"));
      b.classList.add("active");
      renderProducts(b.dataset.cat);
    };
  });
}

function renderProducts(cat="All") {
  const list = cat === "All" ? products : products.filter(p => p.category === cat);
  const visibleProducts = list.filter(p => p.active !== false);

  if (!visibleProducts.length) {
    $("products").innerHTML = `
      <div class="card" style="grid-column:1/-1;text-align:center;padding:30px 18px">
        <div style="font-size:38px">🥖</div>
        <h3>Menu is being prepared</h3>
        <p style="color:#8c7d72;font-size:13px">
          Please try again in a moment.
        </p>
        <button class="primary" onclick="loadProducts().then(()=>{renderCats();renderProducts();})">
          Refresh menu
        </button>
      </div>`;
    return;
  }

  $("products").innerHTML = visibleProducts.map(p => `
    <article class="product">
      <div class="emoji">${p.emoji || "🥖"}</div>
      <h3>${esc(p.name)}</h3>
      <div class="meta">${esc(p.category || "Bakery")}</div>
      <div class="bottom">
        <span class="price">${money(p.price)}</span>
        <button class="add" onclick="add(${Number(p.id)})">+</button>
      </div>
    </article>
  `).join("");
}

function add(id) {
  const p = products.find(x => Number(x.id) === Number(id));
  if (!p) return;
  const x = cart.find(x => Number(x.id) === Number(id));
  if (x) x.qty++;
  else cart.push({id:p.id,name:p.name,price:Number(p.price),qty:1});
  saveCart();
  toast(`${p.name} added`);
}

function change(id,d) {
  const x = cart.find(x => Number(x.id) === Number(id));
  if (!x) return;
  x.qty += d;
  if (x.qty <= 0) cart = cart.filter(y => Number(y.id) !== Number(id));
  saveCart();
  renderCart();
}

function renderCart() {
  const subtotal = cartSubtotal();
  const deliveryFee = Number(CONFIG.DELIVERY_FEE || 0);
  const total = orderTotalWithDelivery(subtotal);
  $("cartItems").innerHTML = cart.length ? cart.map(x => `
    <div class="cart-line">
      <div class="info"><strong>${esc(x.name)}</strong><div>${money(x.price)}</div></div>
      <div class="qty">
        <button onclick="change(${Number(x.id)},-1)">−</button>
        <b>${x.qty}</b>
        <button onclick="change(${Number(x.id)},1)">+</button>
      </div>
    </div>
  `).join("") : "<p>Your cart is empty.</p>";
  $("cartTotal").innerHTML = `
    <div class="cart-total">
      <div class="cart-total-row"><span>Subtotal</span><span>${money(subtotal)}</span></div>
      <div class="cart-total-row"><span>Delivery</span><span>${money(deliveryFee)}</span></div>
      <div class="cart-total-row cart-grand-total"><span>Total</span><span>${money(total)}</span></div>
    </div>`;
  $("checkoutBtn").disabled = !cart.length;
  $("checkoutBtn").style.opacity = cart.length ? 1 : .5;
}

function openCart() {
  renderCart();
  $("drawer").classList.add("open");
}

function closeCart() {
  $("drawer").classList.remove("open");
}

function renderCheckout() {
  const subtotal = cartSubtotal();
  const deliveryFee = Number(CONFIG.DELIVERY_FEE || 0);
  const total = orderTotalWithDelivery(subtotal);

  $("summary").innerHTML =
    cart.map(x => `<div class="summary-row"><span>${x.qty} × ${esc(x.name)}</span><span>${money(x.qty*x.price)}</span></div>`).join("") +
    `<div class="summary-row"><span>Subtotal</span><span>${money(subtotal)}</span></div>` +
    `<div class="summary-row"><span>Delivery</span><span>${money(deliveryFee)}</span></div>` +
    `<div class="summary-row grand-total"><span>Total</span><span>${money(total)}</span></div>`;

  $("slots").innerHTML = CONFIG.DELIVERY_SLOTS.map(s => `
    <button type="button" class="slot ${selectedSlot===s?"selected":""}" data-slot="${esc(s)}">
      <strong>${esc(s)}</strong><small>Tomorrow</small>
    </button>
  `).join("");

  document.querySelectorAll(".slot").forEach(b => {
    b.onclick = () => { selectedSlot = b.dataset.slot; renderCheckout(); };
  });

  if (customer) {
    $("name").value = customer.name || "";
    $("phone").value = customer.phone || "";
    $("address").value = customer.address || "";
  }
}


async function syncCustomerOrders() {
  if (CONFIG.DEMO_MODE || !CONFIG.API_URL || CONFIG.API_URL.includes("PASTE_")) {
    return;
  }

  if (!customer || !customer.phone) {
    activeOrders = [];
    saveOrders();
    return;
  }

  try {
    const url =
      CONFIG.API_URL +
      "?action=orders&phone=" +
      encodeURIComponent(customer.phone);

    const response = await fetch(url, { cache: "no-store" });
    const result = await response.json();

    if (!result.ok) throw new Error(result.error || "Could not load orders");

    activeOrders = (result.orders || []).map(order => ({
      ...order,
      status: order.status || "Active",
      items: order.items || []
    }));

    saveOrders();
    renderOrders();
  } catch (error) {
    console.warn("Order sync failed:", error);
  }
}

function renderOrders() {
  const list = $("ordersList");
  const active = activeOrders.filter(o => String(o.status).toLowerCase() === "active");
  updateOrdersBadge();

  if (!active.length) {
    list.innerHTML = "";
    $("noOrders").style.display = "block";
    return;
  }

  $("noOrders").style.display = "none";

  list.innerHTML = active.map(order => {
    const items = (order.items || []).map(item => `
      <div class="order-item">
        <span>${Number(item.qty)} × ${esc(item.name)}</span>
        <span>${money(Number(item.qty)*Number(item.price))}</span>
      </div>
    `).join("");

    const cancellation = isCancellationOpen()
      ? `<button class="cancel-order-button" onclick="cancelActiveOrder('${esc(order.orderId)}')">Cancel order</button>`
      : `<div class="cancel-closed">🔒 Cancellation closed at 10:00 PM</div>`;

    return `
      <div class="order-card">
        <div class="order-card-head">
          <div>
            <div class="order-number">${esc(order.orderId)}</div>
            <div class="order-date">Placed ${esc(order.displayDate || "today")}</div>
          </div>
          <div class="order-status">Active</div>
        </div>
        ${items}
        <div class="order-total"><span>Total</span><span>${money(order.total)}</span></div>
        <div class="order-delivery">🚚 Tomorrow · <strong>${esc(order.slot)}</strong></div>
        ${cancellation}
      </div>
    `;
  }).join("");
}

async function cancelActiveOrder(orderId) {
  const order = activeOrders.find(o => o.orderId === orderId);
  if (!order) return;

  if (!isCancellationOpen()) {
    toast("Orders can only be cancelled before 10 PM.");
    renderOrders();
    return;
  }

  if (!confirm("Are you sure you want to cancel this order?")) return;

  if (!CONFIG.DEMO_MODE && CONFIG.API_URL && !CONFIG.API_URL.includes("PASTE_")) {
    try {
      const response = await fetch(CONFIG.API_URL, {
        method:"POST",
        headers:{"Content-Type":"text/plain;charset=utf-8"},
        body:JSON.stringify({
          action:"cancelOrder",
          orderId:order.orderId,
          phone:customer?.phone || ""
        })
      });
      const result = await response.json();
      if (!result.ok) throw new Error(result.error || "Could not cancel order");
    } catch (error) {
      toast(error.message || "Could not cancel order");
      return;
    }
  }

  order.status = "Cancelled";
  order.cancelledAt = new Date().toISOString();
  saveOrders();
  renderOrders();
  toast("Order cancelled successfully.");
}


function googleJsonp(params, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const callbackName =
      "moharamBakeJsonp_" + Date.now() + "_" +
      Math.random().toString(36).slice(2);

    const script = document.createElement("script");
    const query = new URLSearchParams({
      ...params,
      callback: callbackName,
      _: Date.now().toString()
    });

    let finished = false;

    const cleanup = () => {
      if (script.parentNode) script.parentNode.removeChild(script);
      try { delete window[callbackName]; } catch (_) {}
      clearTimeout(timer);
    };

    const finish = (fn, value) => {
      if (finished) return;
      finished = true;
      cleanup();
      fn(value);
    };

    window[callbackName] = data => finish(resolve, data);

    script.onerror = () =>
      finish(reject, new Error("Google Apps Script request failed"));

    const timer = setTimeout(() => {
      finish(reject, new Error("Google Apps Script request timed out"));
    }, timeoutMs);

    script.src = CONFIG.API_URL + "?" + query.toString();
    document.head.appendChild(script);
  });
}

async function loadProducts() {
  if (CONFIG.DEMO_MODE || !CONFIG.API_URL || CONFIG.API_URL.includes("PASTE_")) {
    products = fallbackProducts;
    return;
  }

  try {
    const j = await googleJsonp({ action: "products" });

    if (!j || !j.ok) {
      throw new Error((j && j.error) || "Google Sheets returned an error");
    }

    products = Array.isArray(j.products) && j.products.length
      ? j.products
      : fallbackProducts;

    if (!Array.isArray(j.products) || !j.products.length) {
      toast("Products sheet is empty — showing starter menu");
    }
  } catch (e) {
    console.warn("Google Sheets products error:", e);
    products = fallbackProducts;
    toast("Could not load online menu — showing starter menu");
  }
}

async function submitOrder(order) {
  if (CONFIG.DEMO_MODE || !CONFIG.API_URL || CONFIG.API_URL.includes("PASTE_")) {
    await new Promise(r => setTimeout(r, 500));
    return {ok:true,orderId:"MB-DEMO-"+Math.floor(Math.random()*9000+1000)};
  }

  const r = await fetch(CONFIG.API_URL, {
    method:"POST",
    headers:{"Content-Type":"text/plain;charset=utf-8"},
    body:JSON.stringify({action:"createOrder",...order})
  });
  return r.json();
}

$("startBtn").onclick = () => show("menu");
$("ordersBtn").onclick = async () => {
  show("orders");
  renderOrders();
  await syncCustomerOrders();
};
if ($("homeLogoBtn")) $("homeLogoBtn").onclick = () => show("home");
if ($("ordersBackBtn")) $("ordersBackBtn").onclick = () => show("home");
$("cartBtn").onclick = openCart;
$("menuCart").onclick = openCart;
$("close").onclick = closeCart;
$("drawer").querySelector(".shade").onclick = closeCart;
$("checkoutBtn").onclick = () => { closeCart(); renderCheckout(); show("checkout"); };
$("back").onclick = () => show("menu");
$("again").onclick = () => show("menu");
$("viewOrdersAfterSuccess").onclick = () => { renderOrders(); show("orders"); };
$("orderFromEmpty").onclick = () => show("menu");

$("checkoutForm").onsubmit = async e => {
  e.preventDefault();

  if (!selectedSlot) { toast("Please choose a delivery slot"); return; }
  if (!cart.length) { toast("Your cart is empty"); show("menu"); return; }

  const order = {
    customer:{
      name:$("name").value.trim(),
      phone:$("phone").value.trim(),
      address:$("address").value.trim()
    },
    slot:selectedSlot,
    items:cart.map(x => ({id:x.id,name:x.name,price:x.price,qty:x.qty}))
  };

  customer = order.customer;
  localStorage.setItem("mb_customer", JSON.stringify(customer));

  const btn = e.submitter;
  btn.disabled = true;
  btn.textContent = "Placing order…";

  try {
    const result = await submitOrder(order);
    if (!result.ok) throw new Error(result.error || "Order failed");

    const subtotal = order.items.reduce(
      (sum,item) => sum + Number(item.price) * Number(item.qty),
      0
    );
    const total = Number(result.total ?? orderTotalWithDelivery(subtotal));

    const newOrder = {
      orderId:result.orderId || "Order received",
      createdAt:new Date().toISOString(),
      displayDate:new Date().toLocaleString(),
      status:"Active",
      customer:order.customer,
      slot:order.slot,
      items:order.items,
      total:total
    };

    activeOrders.push(newOrder);
    saveOrders();
    // Refresh from Google Sheets after the backend has accepted the order.
    await syncCustomerOrders();

    $("orderRef").textContent = newOrder.orderId;
    $("cancelInfo").textContent = isCancellationOpen()
      ? `Delivery fee: ${money(CONFIG.DELIVERY_FEE)} · You can cancel this order until 10:00 PM today.`
      : `Delivery fee: ${money(CONFIG.DELIVERY_FEE)} · The cancellation window has closed at 10:00 PM.`;

    $("cancelOrderBtn").style.display = isCancellationOpen() ? "block" : "none";

    cart = [];
    saveCart();
    show("success");
  } catch (err) {
    toast(err.message || "Could not place order");
  } finally {
    btn.disabled = false;
    btn.textContent = "Place order";
  }
};

(async () => {
  await loadProducts();
  renderCats();
  renderProducts();
  updateCartBadges();
  updateOrdersBadge();
  setupInstallPrompt();
  if (customer && customer.phone) syncCustomerOrders();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(()=>{});
})();
