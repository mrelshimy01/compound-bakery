const CONFIG = {
  API_URL: "PASTE_YOUR_GOOGLE_APPS_SCRIPT_WEB_APP_URL_HERE",
  DEMO_MODE: true,
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

const $ = id => document.getElementById(id);

function money(n) {
  return `${Number(n).toFixed(2).replace(/\.00$/, "")} EGP`;
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
  $("products").innerHTML = list.filter(p => p.active !== false).map(p => `
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
  const total = cart.reduce((s,x) => s + x.price*x.qty, 0);
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
  $("cartTotal").innerHTML = `<div class="cart-total">Total ${money(total)}</div>`;
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
  const total = cart.reduce((s,x) => s + x.price*x.qty, 0);
  $("summary").innerHTML =
    cart.map(x => `<div class="summary-row"><span>${x.qty} × ${esc(x.name)}</span><span>${money(x.qty*x.price)}</span></div>`).join("") +
    `<div class="summary-row"><span>Total</span><span>${money(total)}</span></div>`;

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

function renderOrders() {
  const list = $("ordersList");
  const active = activeOrders.filter(o => o.status === "Active");
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

async function loadProducts() {
  if (CONFIG.DEMO_MODE || !CONFIG.API_URL || CONFIG.API_URL.includes("PASTE_")) {
    products = fallbackProducts;
    return;
  }

  try {
    const r = await fetch(CONFIG.API_URL + "?action=products", {cache:"no-store"});
    const j = await r.json();
    products = j.products || fallbackProducts;
  } catch (e) {
    products = fallbackProducts;
    toast("Using offline menu");
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
$("ordersBtn").onclick = () => { renderOrders(); show("orders"); };
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

    const total = order.items.reduce((sum,item) => sum + Number(item.price)*Number(item.qty), 0);

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

    $("orderRef").textContent = newOrder.orderId;
    $("cancelInfo").textContent = isCancellationOpen()
      ? "You can cancel this order until 10:00 PM today."
      : "The cancellation window has closed at 10:00 PM.";

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
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(()=>{});
})();
