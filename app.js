const CONFIG = {
  API_URL:
    "https://script.google.com/macros/s/AKfycbx2Vkfpsnk-wtYUMF9aky7PySvinXXvWcWweRJVhoeFiGWG5thyoVL6H1elqHAnEq3Eww/exec",

  DEMO_MODE: false,

  DELIVERY_SLOTS: [
    "8:00–10:00 AM",
    "10:00 AM–12:00 PM",
    "12:00–2:00 PM",
    "2:00–4:00 PM"
  ]
};

let products = [];
let cart = JSON.parse(localStorage.getItem("mb_cart") || "[]");
let customer = JSON.parse(localStorage.getItem("mb_customer") || "null");
let activeOrders = JSON.parse(
  localStorage.getItem("mb_active_orders") || "[]"
);

let selectedSlot = "";
let lastOrder = null;
let deferredInstallPrompt = null;

const $ = id => document.getElementById(id);


/* =========================================================
   PHONE NUMBER
========================================================= */

/*
 * MoharamBake ALWAYS uses Egyptian LOCAL format.
 *
 * +201275122774   -> 01275122774
 * 00201275122774  -> 01275122774
 * 201275122774    -> 01275122774
 * 01275122774     -> 01275122774
 * 1275122774      -> 01275122774
 */
function normalizePhone(phone) {
  if (phone === null || phone === undefined) {
    return "";
  }

  let value = String(phone).trim();

  value = value.replace(/[^\d+]/g, "");
  value = value.replace(/^\+/, "");
  value = value.replace(/\.0$/, "");

  if (value.startsWith("0020")) {
    value = "0" + value.substring(4);
  } else if (value.startsWith("002")) {
    value = "0" + value.substring(3);
  } else if (
    value.startsWith("20") &&
    value.length === 12
  ) {
    value = "0" + value.substring(2);
  }

  value = value.replace(/\D/g, "");

  if (
    value.length === 10 &&
    value.startsWith("1")
  ) {
    value = "0" + value;
  }

  if (
    value.startsWith("20") &&
    value.length === 12
  ) {
    value = "0" + value.substring(2);
  }

  return value;
}


/*
 * Normalize customer information before storing it.
 */
function normalizeCustomer(data) {
  if (!data) return null;

  return {
    name: String(data.name || "").trim(),
    phone: normalizePhone(data.phone || ""),
    address: String(data.address || "").trim()
  };
}


/* =========================================================
   BASIC HELPERS
========================================================= */

function money(value) {
  const n = Number(value) || 0;

  return `${n
    .toFixed(2)
    .replace(/\.00$/, "")
    .replace(/(\.\d)0$/, "")} EGP`;
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function toast(message) {
  const el = $("toast");

  if (!el) return;

  el.textContent = message;
  el.classList.add("show");

  setTimeout(() => {
    el.classList.remove("show");
  }, 2500);
}

function show(screenId) {
  document
    .querySelectorAll(".screen")
    .forEach(screen =>
      screen.classList.remove("active")
    );

  const target = $(screenId);

  if (!target) {
    console.warn("Screen not found:", screenId);
    return;
  }

  target.classList.add("active");

  window.scrollTo({
    top: 0,
    behavior: "instant"
  });
}


/* =========================================================
   LOCAL STORAGE
========================================================= */

function saveCart() {
  localStorage.setItem(
    "mb_cart",
    JSON.stringify(cart)
  );

  updateCartBadges();
}

function saveCustomer() {
  if (customer) {
    customer = normalizeCustomer(customer);
  }

  localStorage.setItem(
    "mb_customer",
    JSON.stringify(customer)
  );
}

function saveOrders() {
  localStorage.setItem(
    "mb_active_orders",
    JSON.stringify(activeOrders)
  );

  updateOrdersBadge();
}


/*
 * Clean old local customer data once.
 */
function normalizeStoredCustomer() {
  if (!customer) return;

  const normalized =
    normalizeCustomer(customer);

  if (
    JSON.stringify(normalized) !==
    JSON.stringify(customer)
  ) {
    customer = normalized;
    saveCustomer();
  }
}


/* =========================================================
   BADGES
========================================================= */

function updateCartBadges() {
  const count = cart.reduce(
    (total, item) =>
      total + Number(item.qty || 0),
    0
  );

  if ($("cartBadge")) {
    $("cartBadge").textContent = count;
  }

  if ($("menuBadge")) {
    $("menuBadge").textContent = count;
  }
}

function updateOrdersBadge() {
  const count = activeOrders.filter(
    order =>
      String(order.status).toLowerCase() ===
      "active"
  ).length;

  if ($("ordersBadge")) {
    $("ordersBadge").textContent = count;
  }
}


/* =========================================================
   CANCELLATION
========================================================= */

function isCancellationOpen() {
  const now = new Date();

  const cutoff = new Date(now);
  cutoff.setHours(22, 0, 0, 0);

  return now < cutoff;
}


/* =========================================================
   INSTALL APP
========================================================= */

function isIOS() {
  return (
    /iphone|ipad|ipod/i.test(
      navigator.userAgent
    ) ||
    (
      navigator.platform === "MacIntel" &&
      navigator.maxTouchPoints > 1
    )
  );
}

function isAndroid() {
  return /android/i.test(
    navigator.userAgent
  );
}

function isStandalone() {
  return (
    window.matchMedia(
      "(display-mode: standalone)"
    ).matches ||
    window.navigator.standalone === true
  );
}

function setupInstallCTA() {
  const button = $("installAppBtn");
  const hint = $("installHint");
  const title = $("installTitle");

  if (!button) return;

  if (isStandalone()) {
    button.classList.add("installed");
    return;
  }

  if (isIOS()) {
    if (title) {
      title.textContent =
        "Install MoharamBake";
    }

    if (hint) {
      hint.textContent =
        "Add it to your iPhone Home Screen";
    }
  } else if (isAndroid()) {
    if (title) {
      title.textContent =
        "Install MoharamBake";
    }

    if (hint) {
      hint.textContent =
        "Install the app on your Android phone";
    }
  } else {
    if (hint) {
      hint.textContent =
        "Install the app on your phone";
    }
  }

  button.onclick = async () => {

    if (deferredInstallPrompt) {

      deferredInstallPrompt.prompt();

      const result =
        await deferredInstallPrompt.userChoice;

      deferredInstallPrompt = null;

      if (
        result &&
        result.outcome === "accepted"
      ) {
        button.classList.add(
          "installed"
        );
      }

      return;
    }

    if (isIOS()) {

      const modal =
        $("iosInstallModal");

      if (modal) {
        modal.hidden = false;
      }

      return;
    }

    toast(
      "Open your browser menu and choose Install app."
    );
  };
}

function setupInstallPrompt() {

  window.addEventListener(
    "beforeinstallprompt",
    event => {

      event.preventDefault();

      deferredInstallPrompt = event;

      setupInstallCTA();
    }
  );

  window.addEventListener(
    "appinstalled",
    () => {

      deferredInstallPrompt = null;

      const button =
        $("installAppBtn");

      if (button) {
        button.classList.add(
          "installed"
        );
      }
    }
  );

  const close =
    $("closeInstallModal");

  const done =
    $("iosDone");

  if (close) {
    close.onclick = () => {
      $("iosInstallModal").hidden = true;
    };
  }

  if (done) {
    done.onclick = () => {
      $("iosInstallModal").hidden = true;
    };
  }

  setupInstallCTA();
}


/* =========================================================
   PRODUCTS
========================================================= */

async function loadProducts() {

  if (
    CONFIG.DEMO_MODE ||
    !CONFIG.API_URL
  ) {
    products = [];

    renderProductsError(
      "Google Sheets integration is not configured."
    );

    return;
  }

  try {

    const url =
      CONFIG.API_URL +
      "?action=products&_=" +
      Date.now();

    console.log(
      "Loading products from:",
      url
    );

    const response =
      await fetch(url, {
        method: "GET",
        cache: "no-store",
        redirect: "follow"
      });

    if (!response.ok) {
      throw new Error(
        `Google Apps Script returned HTTP ${response.status}`
      );
    }

    const data =
      await response.json();

    console.log(
      "Google Sheets products response:",
      data
    );

    if (
      !data ||
      data.ok !== true
    ) {
      throw new Error(
        data?.error ||
        "Google Sheets returned an invalid response."
      );
    }

    if (
      !Array.isArray(data.products)
    ) {
      throw new Error(
        "Products response is not an array."
      );
    }

    products =
      data.products
        .map(product => ({
          id: product.id,
          name: product.name,
          category:
            product.category ||
            "Bakery",
          price:
            Number(product.price) || 0,
          emoji:
            product.emoji || "🥖",
          active:
            product.active !== false
        }))
        .filter(product =>
          product.name &&
          product.active !== false
        );

    console.log(
      `Loaded ${products.length} products.`,
      products
    );

    renderCats();
    renderProducts();

    if (!products.length) {
      renderProductsError(
        "No active products were found in Google Sheets."
      );
    }

    return products;

  } catch (error) {

    console.error(
      "Google Sheets products error:",
      error
    );

    products = [];

    renderProductsError(
      "We couldn't load the menu from Google Sheets."
    );

    return [];
  }
}

function renderProductsError(message) {

  const container =
    $("products");

  if (!container) return;

  container.innerHTML = `
    <div
      class="card"
      style="
        grid-column:1/-1;
        text-align:center;
        padding:30px 18px;
      "
    >
      <div style="font-size:42px">🥖</div>

      <h3>Menu unavailable</h3>

      <p
        style="
          color:#8c7d72;
          font-size:13px;
          line-height:1.5;
        "
      >
        ${esc(message)}
      </p>

      <button
        class="primary"
        id="refreshMenuBtn"
        type="button"
      >
        Refresh menu
      </button>
    </div>
  `;

  const button =
    $("refreshMenuBtn");

  if (button) {

    button.onclick =
      async () => {

        button.disabled = true;
        button.textContent =
          "Loading...";

        await loadProducts();

        if (products.length) {
          toast("Menu updated.");
        }

        button.disabled = false;
        button.textContent =
          "Refresh menu";
      };
  }
}


/* =========================================================
   CATEGORIES
========================================================= */

function renderCats() {

  const container =
    $("cats");

  if (!container) return;

  const categories = [
    "All",
    ...new Set(
      products
        .map(product =>
          product.category
        )
        .filter(Boolean)
    )
  ];

  container.innerHTML =
    categories
      .map(
        (category, index) => `
          <button
            class="chip ${
              index === 0
                ? "active"
                : ""
            }"
            data-cat="${esc(category)}"
            type="button"
          >
            ${esc(category)}
          </button>
        `
      )
      .join("");

  container
    .querySelectorAll(".chip")
    .forEach(button => {

      button.onclick = () => {

        container
          .querySelectorAll(".chip")
          .forEach(x =>
            x.classList.remove(
              "active"
            )
          );

        button.classList.add(
          "active"
        );

        renderProducts(
          button.dataset.cat
        );
      };
    });
}

function renderProducts(
  category = "All"
) {

  const container =
    $("products");

  if (!container) return;

  const filtered =
    category === "All"
      ? products
      : products.filter(
          product =>
            product.category ===
            category
        );

  if (!filtered.length) {

    renderProductsError(
      "There are no products in this category."
    );

    return;
  }

  container.innerHTML =
    filtered
      .map(
        product => `
          <article class="product">

            <div class="emoji">
              ${esc(product.emoji)}
            </div>

            <h3>
              ${esc(product.name)}
            </h3>

            <div class="meta">
              ${esc(
                product.category ||
                "Bakery"
              )}
            </div>

            <div class="bottom">

              <span class="price">
                ${money(product.price)}
              </span>

              <button
                class="add"
                type="button"
                data-product-id="${esc(
                  product.id
                )}"
              >
                +
              </button>

            </div>

          </article>
        `
      )
      .join("");

  container
    .querySelectorAll(".add")
    .forEach(button => {

      button.onclick = () => {

        add(
          button.dataset.productId
        );
      };
    });
}


/* =========================================================
   CART
========================================================= */

function add(id) {

  const product =
    products.find(
      item =>
        String(item.id) ===
        String(id)
    );

  if (!product) {
    toast(
      "Product is unavailable."
    );

    return;
  }

  const existing =
    cart.find(
      item =>
        String(item.id) ===
        String(id)
    );

  if (existing) {
    existing.qty += 1;
  } else {

    cart.push({
      id: product.id,
      name: product.name,
      price: Number(product.price),
      qty: 1
    });
  }

  saveCart();

  toast(
    `${product.name} added`
  );
}

function change(id, delta) {

  const item =
    cart.find(
      x =>
        String(x.id) ===
        String(id)
    );

  if (!item) return;

  item.qty += delta;

  if (item.qty <= 0) {

    cart =
      cart.filter(
        x =>
          String(x.id) !==
          String(id)
      );
  }

  saveCart();

  renderCart();
}

function renderCart() {

  const items =
    $("cartItems");

  const totalElement =
    $("cartTotal");

  const checkoutButton =
    $("checkoutBtn");

  if (!items) return;

  const total =
    cart.reduce(
      (sum, item) =>
        sum +
        Number(item.price) *
        Number(item.qty),
      0
    );

  if (!cart.length) {

    items.innerHTML =
      "<p>Your cart is empty.</p>";

  } else {

    items.innerHTML =
      cart
        .map(
          item => `
            <div class="cart-line">

              <div class="info">
                <strong>
                  ${esc(item.name)}
                </strong>

                <div>
                  ${money(item.price)}
                </div>
              </div>

              <div class="qty">

                <button
                  type="button"
                  data-action="minus"
                  data-id="${esc(item.id)}"
                >
                  −
                </button>

                <b>
                  ${item.qty}
                </b>

                <button
                  type="button"
                  data-action="plus"
                  data-id="${esc(item.id)}"
                >
                  +
                </button>

              </div>

            </div>
          `
        )
        .join("");

    items
      .querySelectorAll("button")
      .forEach(button => {

        const id =
          button.dataset.id;

        const delta =
          button.dataset.action ===
          "plus"
            ? 1
            : -1;

        button.onclick =
          () =>
            change(
              id,
              delta
            );
      });
  }

  if (totalElement) {

    totalElement.innerHTML = `
      <div class="cart-total">
        Total ${money(total)}
      </div>
    `;
  }

  if (checkoutButton) {

    checkoutButton.disabled =
      cart.length === 0;

    checkoutButton.style.opacity =
      cart.length
        ? "1"
        : ".5";
  }
}

function openCart() {

  renderCart();

  const drawer =
    $("drawer");

  if (drawer) {
    drawer.classList.add(
      "open"
    );
  }
}

function closeCart() {

  const drawer =
    $("drawer");

  if (drawer) {
    drawer.classList.remove(
      "open"
    );
  }
}


/* =========================================================
   CHECKOUT
========================================================= */

function renderCheckout() {

  const summary =
    $("summary");

  if (!summary) return;

  const total =
    cart.reduce(
      (sum, item) =>
        sum +
        Number(item.price) *
        Number(item.qty),
      0
    );

  summary.innerHTML =
    cart
      .map(
        item => `
          <div class="summary-row">
            <span>
              ${item.qty} ×
              ${esc(item.name)}
            </span>

            <span>
              ${money(
                item.qty *
                item.price
              )}
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

  const slots =
    $("slots");

  if (slots) {

    slots.innerHTML =
      CONFIG.DELIVERY_SLOTS
        .map(
          slot => `
            <button
              type="button"
              class="slot ${
                selectedSlot === slot
                  ? "selected"
                  : ""
              }"
              data-slot="${esc(slot)}"
            >
              <strong>
                ${esc(slot)}
              </strong>

              <small>
                Tomorrow
              </small>
            </button>
          `
        )
        .join("");

    slots
      .querySelectorAll(".slot")
      .forEach(button => {

        button.onclick = () => {

          selectedSlot =
            button.dataset.slot;

          renderCheckout();
        };
      });
  }

  if (customer) {

    if ($("name")) {
      $("name").value =
        customer.name || "";
    }

    if ($("phone")) {
      $("phone").value =
        customer.phone || "";
    }

    if ($("address")) {
      $("address").value =
        customer.address || "";
    }
  }
}


/* =========================================================
   CREATE ORDER
========================================================= */

async function createOrder() {

  if (!cart.length) {
    toast("Your cart is empty.");
    return;
  }

  if (!selectedSlot) {
    toast(
      "Please select a delivery slot."
    );

    return;
  }

  const name =
    $("name")?.value.trim();

  /*
   * IMPORTANT:
   * Normalize immediately when user submits.
   */
  const phone =
    normalizePhone(
      $("phone")?.value.trim()
    );

  const address =
    $("address")?.value.trim();

  if (!name || !phone || !address) {

    toast(
      "Please complete your delivery details."
    );

    return;
  }

  /*
   * Also update the visible input to the
   * canonical local format.
   */
  if ($("phone")) {
    $("phone").value = phone;
  }

  const submitButton =
    document.querySelector(
      '#checkoutForm button[type="submit"]'
    );

  if (submitButton) {
    submitButton.disabled = true;
    submitButton.textContent =
      "Placing order...";
  }

  const normalizedCustomer = {
    name,
    phone,
    address
  };

  const orderData = {

    action:
      "createOrder",

    customer:
      normalizedCustomer,

    /*
     * Also send top-level values so the backend
     * remains compatible with both formats.
     */
    name,
    phone,
    address,

    slot:
      selectedSlot,

    deliverySlot:
      selectedSlot,

    items:
      cart.map(item => ({
        id: item.id,
        productId: item.id,
        name: item.name,
        product: item.name,
        price:
          Number(item.price),
        qty:
          Number(item.qty),
        quantity:
          Number(item.qty)
      }))
  };

  try {

    const response =
      await fetch(
        CONFIG.API_URL,
        {
          method: "POST",

          headers: {
            "Content-Type":
              "text/plain;charset=utf-8"
          },

          body:
            JSON.stringify(
              orderData
            )
        }
      );

    if (!response.ok) {
      throw new Error(
        `Order request failed (${response.status})`
      );
    }

    const result =
      await response.json();

    console.log(
      "Create order response:",
      result
    );

    if (!result.ok) {
      throw new Error(
        result.error ||
        "Unable to place order."
      );
    }

    customer =
      normalizedCustomer;

    saveCustomer();

    lastOrder = {

      orderId:
        result.orderId,

      total:
        result.total,

      slot:
        selectedSlot,

      status:
        "Active",

      phone:
        phone,

      items:
        cart.map(item => ({
          id:
            item.id,
          name:
            item.name,
          qty:
            item.qty,
          price:
            item.price
        }))
    };

    activeOrders.unshift(
      lastOrder
    );

    saveOrders();

    cart = [];

    saveCart();

    renderSuccess();

    show("success");

    /*
     * Give the backend a moment to finish
     * writing to Sheets, then sync.
     */
    setTimeout(
      syncCustomerOrders,
      1500
    );

  } catch (error) {

    console.error(
      "Create order error:",
      error
    );

    toast(
      error.message ||
      "Unable to place order. Please try again."
    );

  } finally {

    if (submitButton) {

      submitButton.disabled =
        false;

      submitButton.textContent =
        "Place order";
    }
  }
}


/* =========================================================
   SUCCESS
========================================================= */

function renderSuccess() {

  if (!lastOrder) return;

  if ($("orderRef")) {

    $("orderRef").innerHTML = `
      <strong>
        Order ${esc(
          lastOrder.orderId
        )}
      </strong>
      <br>
      ${money(lastOrder.total)}
    `;
  }

  if ($("cancelInfo")) {

    if (isCancellationOpen()) {

      $("cancelInfo").textContent =
        "You can cancel this order before 10:00 PM.";

    } else {

      $("cancelInfo").textContent =
        "Cancellation is closed after 10:00 PM.";
    }
  }

  const cancelButton =
    $("cancelOrderBtn");

  if (cancelButton) {

    cancelButton.style.display =
      isCancellationOpen()
        ? "block"
        : "none";

    cancelButton.onclick =
      () =>
        cancelActiveOrder(
          lastOrder.orderId,
          true
        );
  }
}


/* =========================================================
   ACTIVE ORDERS
========================================================= */

async function syncCustomerOrders() {

  if (
    CONFIG.DEMO_MODE ||
    !CONFIG.API_URL
  ) {
    return;
  }

  if (
    !customer ||
    !customer.phone
  ) {

    console.warn(
      "Order sync skipped: no customer phone."
    );

    return;
  }

  /*
   * Normalize the stored phone before
   * every server request.
   */
  customer.phone =
    normalizePhone(
      customer.phone
    );

  saveCustomer();

  try {

    const url =
      CONFIG.API_URL +
      "?action=orders&phone=" +
      encodeURIComponent(
        customer.phone
      ) +
      "&_=" +
      Date.now();

    console.log(
      "Syncing orders for normalized phone:",
      customer.phone
    );

    const response =
      await fetch(
        url,
        {
          method: "GET",
          cache: "no-store",
          redirect: "follow"
        }
      );

    if (!response.ok) {
      throw new Error(
        `Orders request failed (${response.status})`
      );
    }

    const result =
      await response.json();

    console.log(
      "Orders API response:",
      result
    );

    if (!result.ok) {
      throw new Error(
        result.error ||
        "Unable to load orders."
      );
    }

    const serverOrders =
      Array.isArray(result.orders)
        ? result.orders
        : [];

    /*
     * Normalize every server order.
     */
    serverOrders.forEach(
      order => {

        if (order.phone) {
          order.phone =
            normalizePhone(
              order.phone
            );
        }
      }
    );

    /*
     * Merge server orders with local orders.
     *
     * This prevents a temporary API response of []
     * from making a newly created order disappear.
     */
    if (serverOrders.length > 0) {

      const mergedOrders = [
        ...serverOrders
      ];

      activeOrders.forEach(
        localOrder => {

          const exists =
            mergedOrders.some(
              serverOrder =>
                String(
                  serverOrder.orderId
                ) ===
                String(
                  localOrder.orderId
                )
            );

          if (
            !exists &&
            String(
              localOrder.status
            ).toLowerCase() ===
            "active"
          ) {

            mergedOrders.push(
              localOrder
            );
          }
        }
      );

      activeOrders =
        mergedOrders;

    } else {

      /*
       * Do NOT wipe locally-created orders.
       */
      console.warn(
        "Orders API returned zero orders. Keeping local active orders."
      );
    }

    saveOrders();

    renderOrders();

  } catch (error) {

    console.warn(
      "Order sync failed:",
      error
    );

    renderOrders();
  }
}

function renderOrders() {

  const list =
    $("ordersList");

  const empty =
    $("noOrders");

  if (!list) return;

  const active =
    activeOrders.filter(
      order =>
        String(order.status)
          .toLowerCase() ===
        "active"
    );

  updateOrdersBadge();

  if (!active.length) {

    list.innerHTML = "";

    if (empty) {
      empty.style.display =
        "block";
    }

    return;
  }

  if (empty) {
    empty.style.display =
      "none";
  }

  list.innerHTML =
    active
      .map(order => {

        const items =
          (order.items || [])
            .map(
              item => `
                <div class="order-item">

                  <span>
                    ${Number(
                      item.qty ??
                      item.quantity ??
                      1
                    )}
                    ×
                    ${esc(
                      item.name ||
                      item.product ||
                      ""
                    )}
                  </span>

                  <span>
                    ${money(
                      Number(
                        item.qty ??
                        item.quantity ??
                        1
                      ) *
                      Number(
                        item.price
                      )
                    )}
                  </span>

                </div>
              `
            )
            .join("");

        const canCancel =
          isCancellationOpen();

        return `
          <div class="order-card">

            <div class="order-card-head">

              <div>

                <div class="order-number">
                  ${esc(
                    order.orderId
                  )}
                </div>

                <div class="order-date">
                  ${
                    order.createdAt ||
                    order.date
                      ? formatDate(
                          order.createdAt ||
                          order.date
                        )
                      : "Order"
                  }
                </div>

              </div>

              <div class="order-status">
                Active
              </div>

            </div>

            ${items}

            <div class="order-total">

              <span>Total</span>

              <span>
                ${money(
                  order.total
                )}
              </span>

            </div>

            <div class="order-delivery">
              🚚 Tomorrow ·
              <strong>
                ${esc(
                  order.deliverySlot ||
                  order.slot ||
                  ""
                )}
              </strong>
            </div>

            ${
              canCancel
                ? `
                  <button
                    class="cancel-order-button"
                    type="button"
                    data-order-id="${esc(
                      order.orderId
                    )}"
                  >
                    Cancel order
                  </button>
                `
                : `
                  <div class="cancel-closed">
                    🔒 Cancellation closed
                    at 10:00 PM
                  </div>
                `
            }

          </div>
        `;
      })
      .join("");

  list
    .querySelectorAll(
      ".cancel-order-button"
    )
    .forEach(button => {

      button.onclick =
        () =>
          cancelActiveOrder(
            button.dataset.orderId
          );
    });
}

function formatDate(value) {

  if (!value) {
    return "";
  }

  const date =
    new Date(value);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return String(value);
  }

  return (
    "Placed " +
    date.toLocaleDateString(
      "en-EG",
      {
        day: "numeric",
        month: "short",
        year: "numeric"
      }
    )
  );
}


/* =========================================================
   CANCEL ORDER
========================================================= */

async function cancelActiveOrder(
  orderId,
  fromSuccess = false
) {

  if (!isCancellationOpen()) {

    toast(
      "Orders can only be cancelled before 10 PM."
    );

    return;
  }

  const order =
    activeOrders.find(
      item =>
        String(item.orderId) ===
        String(orderId)
    );

  if (!order) {

    toast(
      "Order not found."
    );

    return;
  }

  const confirmed =
    window.confirm(
      "Are you sure you want to cancel this order?"
    );

  if (!confirmed) {
    return;
  }

  try {

    const response =
      await fetch(
        CONFIG.API_URL,
        {
          method: "POST",

          headers: {
            "Content-Type":
              "text/plain;charset=utf-8"
          },

          body:
            JSON.stringify({

              action:
                "cancelOrder",

              orderId:
                order.orderId,

              /*
               * ALWAYS send local format.
               */
              phone:
                normalizePhone(
                  customer?.phone ||
                  ""
                )
            })
        }
      );

    if (!response.ok) {
      throw new Error(
        `Cancellation failed (${response.status})`
      );
    }

    const result =
      await response.json();

    if (!result.ok) {
      throw new Error(
        result.error ||
        "Unable to cancel order."
      );
    }

    order.status =
      "Cancelled";

    saveOrders();

    if (
      lastOrder &&
      String(
        lastOrder.orderId
      ) ===
      String(orderId)
    ) {
      lastOrder.status =
        "Cancelled";
    }

    if (fromSuccess) {

      if ($("cancelOrderBtn")) {
        $("cancelOrderBtn").style.display =
          "none";
      }

      if ($("cancelInfo")) {
        $("cancelInfo").textContent =
          "Your order has been cancelled.";
      }

    } else {

      renderOrders();
    }

    toast(
      "Order cancelled successfully."
    );

  } catch (error) {

    console.error(
      "Cancel order error:",
      error
    );

    toast(
      error.message ||
      "Unable to cancel order."
    );
  }
}


/* =========================================================
   NAVIGATION
========================================================= */

function setupNavigation() {

  const logo =
    $("homeLogoBtn");

  if (logo) {

    logo.onclick =
      () => {
        show("home");
      };
  }

  const start =
    $("startBtn");

  if (start) {

    start.onclick =
      async () => {

        show("menu");

        if (!products.length) {

          $("products").innerHTML = `
            <div
              class="card"
              style="
                grid-column:1/-1;
                text-align:center;
                padding:30px;
              "
            >
              <div style="font-size:38px">
                🥖
              </div>

              <h3>
                Loading tomorrow's menu...
              </h3>
            </div>
          `;

          await loadProducts();

        } else {

          renderCats();
          renderProducts();
        }
      };
  }

  const cartButton =
    $("cartBtn");

  if (cartButton) {
    cartButton.onclick =
      openCart;
  }

  const menuCart =
    $("menuCart");

  if (menuCart) {
    menuCart.onclick =
      openCart;
  }

  const close =
    $("close");

  if (close) {
    close.onclick =
      closeCart;
  }

  const shade =
    document.querySelector(
      ".drawer .shade"
    );

  if (shade) {
    shade.onclick =
      closeCart;
  }

  const checkout =
    $("checkoutBtn");

  if (checkout) {

    checkout.onclick =
      () => {

        if (!cart.length) {

          toast(
            "Your cart is empty."
          );

          return;
        }

        closeCart();

        selectedSlot =
          selectedSlot || "";

        renderCheckout();

        show("checkout");
      };
  }

  const back =
    $("back");

  if (back) {

    back.onclick =
      () => {

        show("menu");

        renderCats();
        renderProducts();
      };
  }

  const ordersButton =
    $("ordersBtn");

  if (ordersButton) {

    ordersButton.onclick =
      async () => {

        show("orders");

        renderOrders();

        await syncCustomerOrders();
      };
  }

  const ordersBack =
    $("ordersBackBtn");

  if (ordersBack) {

    ordersBack.onclick =
      () => {

        show("home");
      };
  }

  const orderEmpty =
    $("orderFromEmpty");

  if (orderEmpty) {

    orderEmpty.onclick =
      async () => {

        show("menu");

        if (!products.length) {
          await loadProducts();
        }

        renderCats();
        renderProducts();
      };
  }

  const again =
    $("again");

  if (again) {

    again.onclick =
      async () => {

        show("menu");

        if (!products.length) {
          await loadProducts();
        }

        renderCats();
        renderProducts();
      };
  }

  const viewOrders =
    $("viewOrdersAfterSuccess");

  if (viewOrders) {

    viewOrders.onclick =
      async () => {

        show("orders");

        renderOrders();

        await syncCustomerOrders();
      };
  }
}


/* =========================================================
   CHECKOUT FORM
========================================================= */

function setupCheckoutForm() {

  const form =
    $("checkoutForm");

  if (!form) return;

  form.addEventListener(
    "submit",
    async event => {

      event.preventDefault();

      await createOrder();
    }
  );
}


/* =========================================================
   STARTUP
========================================================= */

async function init() {

  console.log(
    "MoharamBake app starting..."
  );

  /*
   * Clean old stored phone format.
   */
  normalizeStoredCustomer();

  updateCartBadges();
  updateOrdersBadge();

  setupNavigation();
  setupCheckoutForm();
  setupInstallPrompt();

  renderCart();
  renderOrders();

  /*
   * If an existing customer is stored,
   * sync their orders on startup.
   */
  if (
    customer &&
    customer.phone
  ) {
    syncCustomerOrders();
  }

  console.log(
    "MoharamBake ready."
  );
}


/* =========================================================
   START APP
========================================================= */

if (
  document.readyState ===
  "loading"
) {

  document.addEventListener(
    "DOMContentLoaded",
    init
  );

} else {

  init();
}
