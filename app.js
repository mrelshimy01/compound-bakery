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
  {
    id: 1,
    name: "Baladi Bread",
    category: "Bread",
    price: 3,
    emoji: "🥖",
    active: true
  },
  {
    id: 2,
    name: "Brown Bread",
    category: "Bread",
    price: 5,
    emoji: "🍞",
    active: true
  },
  {
    id: 3,
    name: "Fino",
    category: "Bread",
    price: 4,
    emoji: "🥖",
    active: true
  },
  {
    id: 4,
    name: "Croissant",
    category: "Pastries",
    price: 25,
    emoji: "🥐",
    active: true
  }
];

let products = [];
let cart = JSON.parse(localStorage.getItem("mb_cart") || "[]");
let customer = JSON.parse(localStorage.getItem("mb_customer") || "null");
let selectedSlot = "";

const $ = id => document.getElementById(id);

function money(n) {
  return `${Number(n).toFixed(2).replace(/\.00$/, "")} EGP`;
}

function save() {
  localStorage.setItem("mb_cart", JSON.stringify(cart));
  updateBadges();
}

function updateBadges() {
  const n = cart.reduce((s, x) => s + x.qty, 0);

  if ($("cartBadge")) {
    $("cartBadge").textContent = n;
  }

  if ($("menuBadge")) {
    $("menuBadge").textContent = n;
  }
}

function show(id) {
  document
    .querySelectorAll(".screen")
    .forEach(x => x.classList.remove("active"));

  $(id).classList.add("active");

  window.scrollTo(0, 0);
}

function toast(t) {
  $("toast").textContent = t;
  $("toast").classList.add("show");

  setTimeout(() => {
    $("toast").classList.remove("show");
  }, 2200);
}

function renderCats() {
  const cats = [
    "All",
    ...new Set(products.map(p => p.category).filter(Boolean))
  ];

  $("cats").innerHTML = cats
    .map(
      (c, i) =>
        `<button class="chip ${i === 0 ? "active" : ""}" data-cat="${c}">${c}</button>`
    )
    .join("");

  document.querySelectorAll(".chip").forEach(b => {
    b.onclick = () => {
      document
        .querySelectorAll(".chip")
        .forEach(x => x.classList.remove("active"));

      b.classList.add("active");

      renderProducts(b.dataset.cat);
    };
  });
}

function renderProducts(cat = "All") {
  const list =
    cat === "All"
      ? products
      : products.filter(p => p.category === cat);

  $("products").innerHTML = list
    .filter(p => p.active !== false)
    .map(
      p => `
        <article class="product">
          <div class="emoji">${p.emoji || "🥖"}</div>

          <h3>${esc(p.name)}</h3>

          <div class="meta">
            ${esc(p.category || "Bakery")}
          </div>

          <div class="bottom">
            <span class="price">${money(p.price)}</span>

            <button class="add" onclick="add(${p.id})">
              +
            </button>
          </div>
        </article>
      `
    )
    .join("");
}

function esc(s) {
  return String(s).replace(
    /[&<>"']/g,
    c =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      })[c]
  );
}

function add(id) {
  const p = products.find(
    x => Number(x.id) === Number(id)
  );

  if (!p) return;

  const x = cart.find(
    x => Number(x.id) === Number(id)
  );

  if (x) {
    x.qty++;
  } else {
    cart.push({
      id: p.id,
      name: p.name,
      price: Number(p.price),
      qty: 1
    });
  }

  save();

  toast(`${p.name} added`);
}

function change(id, d) {
  const x = cart.find(
    x => Number(x.id) === Number(id)
  );

  if (!x) return;

  x.qty += d;

  if (x.qty <= 0) {
    cart = cart.filter(
      y => Number(y.id) !== Number(id)
    );
  }

  save();
  renderCart();
}

function renderCart() {
  const total = cart.reduce(
    (s, x) => s + x.price * x.qty,
    0
  );

  $("cartItems").innerHTML = cart.length
    ? cart
        .map(
          x => `
            <div class="cart-line">

              <div class="info">
                <strong>${esc(x.name)}</strong>
                <div>${money(x.price)}</div>
              </div>

              <div class="qty">
                <button onclick="change(${x.id}, -1)">
                  −
                </button>

                <b>${x.qty}</b>

                <button onclick="change(${x.id}, 1)">
                  +
                </button>
              </div>

            </div>
          `
        )
        .join("")
    : `<p>Your cart is empty.</p>`;

  $("cartTotal").innerHTML = `
    <div class="cart-total">
      Total ${money(total)}
    </div>
  `;

  $("checkoutBtn").disabled = !cart.length;

  $("checkoutBtn").style.opacity =
    cart.length ? 1 : 0.5;
}

function openCart() {
  renderCart();

  $("drawer").classList.add("open");
}

function closeCart() {
  $("drawer").classList.remove("open");
}

function renderCheckout() {
  const total = cart.reduce(
    (s, x) => s + x.price * x.qty,
    0
  );

  $("summary").innerHTML =
    cart
      .map(
        x => `
          <div class="summary-row">
            <span>
              ${x.qty} × ${esc(x.name)}
            </span>

            <span>
              ${money(x.qty * x.price)}
            </span>
          </div>
        `
      )
      .join("") +
    `
      <div class="summary-row">
        <span>Total</span>
        <span>${money(total)}</span>
      </div>
    `;

  $("slots").innerHTML =
    CONFIG.DELIVERY_SLOTS
      .map(
        s => `
          <button
            type="button"
            class="slot ${
              selectedSlot === s ? "selected" : ""
            }"
            data-slot="${s}"
          >
            <strong>${s}</strong>
            <small>Tomorrow</small>
          </button>
        `
      )
      .join("");

  document.querySelectorAll(".slot").forEach(b => {
    b.onclick = () => {
      selectedSlot = b.dataset.slot;
      renderCheckout();
    };
  });

  if (customer) {
    $("name").value = customer.name || "";
    $("phone").value = customer.phone || "";
    $("address").value = customer.address || "";
  }
}

async function loadProducts() {
  if (
    CONFIG.DEMO_MODE ||
    !CONFIG.API_URL ||
    CONFIG.API_URL.includes("PASTE_")
  ) {
    products = fallbackProducts;
    return;
  }

  try {
    const r = await fetch(
      CONFIG.API_URL + "?action=products",
      {
        cache: "no-store"
      }
    );

    const j = await r.json();

    products = j.products || fallbackProducts;

  } catch (e) {
    products = fallbackProducts;

    toast("Using offline menu");
  }
}

async function submitOrder(order) {
  if (
    CONFIG.DEMO_MODE ||
    !CONFIG.API_URL ||
    CONFIG.API_URL.includes("PASTE_")
  ) {
    await new Promise(r =>
      setTimeout(r, 500)
    );

    return {
      ok: true,
      orderId:
        "MB-DEMO-" +
        Math.floor(
          Math.random() * 9000 + 1000
        )
    };
  }

  const r = await fetch(CONFIG.API_URL, {
    method: "POST",

    headers: {
      "Content-Type":
        "text/plain;charset=utf-8"
    },

    body: JSON.stringify({
      action: "createOrder",
      ...order
    })
  });

  return r.json();
}


/* =========================
   BUTTONS / NAVIGATION
   ========================= */

$("startBtn").onclick = () => {
  show("menu");
};

$("cartBtn").onclick = openCart;

$("menuCart").onclick = openCart;

$("close").onclick = closeCart;

$("drawer")
  .querySelector(".shade")
  .onclick = closeCart;

$("checkoutBtn").onclick = () => {
  closeCart();

  renderCheckout();

  show("checkout");
};

$("back").onclick = () => {
  show("menu");
};

$("again").onclick = () => {
  show("menu");
};


/* =========================
   CHECKOUT
   ========================= */

$("checkoutForm").onsubmit = async e => {
  e.preventDefault();

  if (!selectedSlot) {
    toast("Please choose a delivery slot");
    return;
  }

  if (!cart.length) {
    toast("Your cart is empty");
    show("menu");
    return;
  }

  const order = {
    customer: {
      name: $("name").value.trim(),
      phone: $("phone").value.trim(),
      address: $("address").value.trim()
    },

    slot: selectedSlot,

    items: cart.map(x => ({
      id: x.id,
      name: x.name,
      price: x.price,
      qty: x.qty
    }))
  };

  customer = order.customer;

  localStorage.setItem(
    "mb_customer",
    JSON.stringify(customer)
  );

  const btn = e.submitter;

  btn.disabled = true;

  btn.textContent =
    "Placing order…";

  try {
    const result =
      await submitOrder(order);

    if (!result.ok) {
      throw new Error(
        result.error ||
          "Order failed"
      );
    }

    $("orderRef").textContent =
      result.orderId ||
      "Order received";

    cart = [];

    save();

    show("success");

  } catch (err) {
    toast(
      err.message ||
        "Could not place order"
    );

  } finally {
    btn.disabled = false;

    btn.textContent =
      "Place order";
  }
};


/* =========================
   INITIALIZE APP
   ========================= */

(async () => {

  await loadProducts();

  renderCats();

  renderProducts();

  updateBadges();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker
      .register("sw.js")
      .catch(() => {});
  }

})();
