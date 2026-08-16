/* PERFORMANCE_OPTIMIZATION_V1 - non-blocking order refresh */

/* =========================================================
   CONFIGURATION
========================================================= */

const GOOGLE_SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbw8NCihVEshMVlm7MK4zktq2hdGQUxeM4hHoLqPeALuSv9sLqATO-y_aAIx972wekzobQ/exec";


/* =========================================================
   APP STATE
========================================================= */

let products = [];

let cart = [];

let activeOrders = [];

let customer = null;

let selectedSlot = "";

let currentCategory = "All";

let currentView = "home";

let lastOrder = null;


/* =========================================================
   HELPERS
========================================================= */

function $(id) {
  return document.getElementById(id);
}


function cleanValue(value) {

  if (
    value === null ||
    value === undefined
  ) {
    return "";
  }

  return String(value).trim();
}


function normalizePhone(phone) {

  let value =
    cleanValue(phone)
      .replace(/\s+/g, "")
      .replace(/-/g, "")
      .replace(/\(/g, "")
      .replace(/\)/g, "");

  /*
   * Remove Egypt country prefix.
   *
   * +201xxxxxxxxx
   * 00201xxxxxxxxx
   *
   * become:
   *
   * 01xxxxxxxxx
   */

  if (
    value.indexOf("+20") === 0
  ) {

    value =
      "0" +
      value.substring(3);

  } else if (
    value.indexOf("0020") === 0
  ) {

    value =
      "0" +
      value.substring(4);

  }

  /*
   * If the number is already stored without
   * the leading zero, restore it.
   */

  if (
    /^1\d{9}$/.test(value)
  ) {

    value =
      "0" +
      value;

  }

  return value;
}


function formatPhoneForStorage(phone) {

  const normalized =
    normalizePhone(phone);

  return normalized;
}


function getCustomerUserId() {

  if (
    customer &&
    customer.userId
  ) {

    return cleanValue(
      customer.userId
    );
  }

  return "";
}


/* =========================================================
   LOCAL STORAGE
========================================================= */

const STORAGE_KEYS = {

  customer:
    "moharambake_customer",

  cart:
    "moharambake_cart",

  orders:
    "moharambake_orders",

  userId:
    "moharambake_user_id"
};


function saveCustomer() {

  try {

    localStorage.setItem(
      STORAGE_KEYS.customer,
      JSON.stringify(
        customer || null
      )
    );

  } catch (error) {

    console.warn(
      "Unable to save customer:",
      error
    );
  }
}


function loadCustomer() {

  try {

    const value =
      localStorage.getItem(
        STORAGE_KEYS.customer
      );

    if (!value) {

      return null;
    }

    const parsed =
      JSON.parse(value);

    if (
      !parsed ||
      typeof parsed !== "object"
    ) {

      return null;
    }

    return parsed;

  } catch (error) {

    console.warn(
      "Unable to load customer:",
      error
    );

    return null;
  }
}


function saveCart() {

  try {

    localStorage.setItem(
      STORAGE_KEYS.cart,
      JSON.stringify(
        cart || []
      )
    );

  } catch (error) {

    console.warn(
      "Unable to save cart:",
      error
    );
  }
}


function loadCart() {

  try {

    const value =
      localStorage.getItem(
        STORAGE_KEYS.cart
      );

    if (!value) {

      return [];
    }

    const parsed =
      JSON.parse(value);

    return Array.isArray(parsed)
      ? parsed
      : [];

  } catch (error) {

    console.warn(
      "Unable to load cart:",
      error
    );

    return [];
  }
}


function saveOrders() {

  try {

    localStorage.setItem(
      STORAGE_KEYS.orders,
      JSON.stringify(
        activeOrders || []
      )
    );

  } catch (error) {

    console.warn(
      "Unable to save orders:",
      error
    );
  }
}


function loadOrders() {

  try {

    const value =
      localStorage.getItem(
        STORAGE_KEYS.orders
      );

    if (!value) {

      return [];
    }

    const parsed =
      JSON.parse(value);

    return Array.isArray(parsed)
      ? parsed
      : [];

  } catch (error) {

    console.warn(
      "Unable to load orders:",
      error
    );

    return [];
  }
}


/* =========================================================
   USER ID
========================================================= */

function getStoredUserId() {

  try {

    return cleanValue(
      localStorage.getItem(
        STORAGE_KEYS.userId
      )
    );

  } catch (error) {

    return "";
  }
}


function saveUserId(userId) {

  const value =
    cleanValue(userId);

  if (!value) {

    return;
  }

  try {

    localStorage.setItem(
      STORAGE_KEYS.userId,
      value
    );

  } catch (error) {

    console.warn(
      "Unable to save User ID:",
      error
    );
  }
}


async function ensureCustomerUserId() {

  if (
    customer &&
    customer.userId
  ) {

    return customer.userId;
  }

  const storedUserId =
    getStoredUserId();

  if (storedUserId) {

    if (!customer) {

      customer = {};
    }

    customer.userId =
      storedUserId;

    saveCustomer();

    return storedUserId;
  }

  return "";
}


/* =========================================================
   GOOGLE SHEETS API
========================================================= */

async function callGoogleScript(
  params = {},
  options = {}
) {

  const query =
    new URLSearchParams();

  Object.keys(params).forEach(
    key => {

      const value =
        params[key];

      if (
        value !== undefined &&
        value !== null
      ) {

        if (
          typeof value === "object"
        ) {

          query.set(
            key,
            JSON.stringify(value)
          );

        } else {

          query.set(
            key,
            String(value)
          );
        }
      }
    }
  );

  const url =
    GOOGLE_SCRIPT_URL +
    "?" +
    query.toString();

  console.log(
    "Calling Google Apps Script:",
    url
  );

  const controller =
    new AbortController();

  const timeout =
    options.timeout ||
    30000;

  const timeoutId =
    setTimeout(
      () => controller.abort(),
      timeout
    );

  try {

    const response =
      await fetch(
        url,
        {
          method: "GET",
          cache: "no-store",
          signal:
            controller.signal
        }
      );

    clearTimeout(
      timeoutId
    );

    if (!response.ok) {

      throw new Error(
        "Google Apps Script returned HTTP " +
        response.status
      );
    }

    const text =
      await response.text();

    if (!text) {

      throw new Error(
        "Google Apps Script returned an empty response."
      );
    }

    let data;

    try {

      data =
        JSON.parse(text);

    } catch (error) {

      console.error(
        "Invalid JSON from Google Apps Script:",
        text
      );

      throw new Error(
        "Invalid response from Google Sheets backend."
      );
    }

    return data;

  } catch (error) {

    clearTimeout(
      timeoutId
    );

    if (
      error &&
      error.name === "AbortError"
    ) {

      throw new Error(
        "Google Sheets request timed out."
      );
    }

    throw error;
  }
}


async function postToGoogleScript(
  payload = {},
  options = {}
) {

  /*
   * Google Apps Script Web Apps frequently redirect.
   *
   * We use GET with the action payload because it is
   * reliable with the deployed Apps Script endpoint.
   */

  const params = {

    action:
      payload.action ||
      "",

    payload:
      JSON.stringify(
        payload
      )
  };

  return callGoogleScript(
    params,
    options
  );
}


/* =========================================================
   PRODUCTS
========================================================= */

async function loadProducts() {

  try {

    console.log(
      "Loading products from:",
      GOOGLE_SCRIPT_URL
    );

    const response =
      await callGoogleScript(
        {
          action:
            "products"
        }
      );

    console.log(
      "Google Sheets products response:",
      response
    );

    if (
      !response ||
      response.ok !== true
    ) {

      throw new Error(
        response &&
        response.error
          ? response.error
          : "Unable to load products."
      );
    }

    const rawProducts =
      Array.isArray(
        response.products
      )
        ? response.products
        : [];

    products =
      rawProducts.map(
        item => {

          return {

            id:
              cleanValue(
                item.id ??
                item.productId ??
                item.ID
              ),

            productId:
              cleanValue(
                item.productId ??
                item.id ??
                item.ID
              ),

            name:
              cleanValue(
                item.name ??
                item.product ??
                item.Product
              ),

            product:
              cleanValue(
                item.product ??
                item.name ??
                item.Product
              ),

            category:
              cleanValue(
                item.category ??
                item.Category
              ),

            price:
              Number(
                item.price ??
                item.Price ??
                0
              ),

            emoji:
              cleanValue(
                item.emoji ??
                item.Emoji
              ),

            image:
              cleanValue(
                item.image ??
                item.Image ??
                item.photo ??
                item.Photo
              ),

            active:
              item.active !== false
          };
        }
      );

    console.log(
      "Loaded " +
      products.length +
      " products."
    );

    renderCats();
    renderProducts();

    return products;

  } catch (error) {

    console.error(
      "Load products error:",
      error
    );

    products = [];

    renderCats();
    renderProducts();

    toast(
      "Unable to load tomorrow's menu."
    );

    return [];
  }
}


/* =========================================================
   PRODUCT DISPLAY
========================================================= */

function getProductVisual(
  product
) {

  if (
    product &&
    product.image
  ) {

    return `
      <img
        src="${escapeHtml(
          product.image
        )}"
        alt="${escapeHtml(
          product.name || ""
        )}"
        style="
          width:64px;
          height:64px;
          object-fit:contain;
          display:block;
        "
        onerror="
          this.style.display='none';
          this.nextElementSibling.style.display='block';
        "
      >
      <span
        style="
          font-size:48px;
          display:none;
        "
      >${escapeHtml(
        product.emoji || "🥖"
      )}</span>
    `;

  }

  return `
    <span
      style="
        font-size:48px;
      "
    >${escapeHtml(
      product &&
      product.emoji
        ? product.emoji
        : "🥖"
    )}</span>
  `;
}


function renderCats() {

  const container =
    $("categories");

  if (!container) {

    return;
  }

  const categories =
    [
      "All",
      ...new Set(
        products
          .map(
            p =>
              cleanValue(
                p.category
              )
          )
          .filter(Boolean)
      )
    ];

  container.innerHTML =
    categories
      .map(
        category => {

          const active =
            category ===
            currentCategory;

          return `
            <button
              class="category-btn ${
                active
                  ? "active"
                  : ""
              }"
              onclick="selectCategory('${escapeJs(
                category
              )}')"
            >
              ${escapeHtml(
                category
              )}
            </button>
          `;
        }
      )
      .join("");
}


function selectCategory(
  category
) {

  currentCategory =
    category;

  renderCats();
  renderProducts();
}


function renderProducts() {

  const container =
    $("products");

  if (!container) {

    return;
  }

  let visibleProducts =
    products.filter(
      product =>
        product.active !== false
    );

  if (
    currentCategory !==
    "All"
  ) {

    visibleProducts =
      visibleProducts.filter(
        product =>
          cleanValue(
            product.category
          ) ===
          currentCategory
      );
  }

  if (
    visibleProducts.length ===
    0
  ) {

    container.innerHTML = `
      <div
        class="card"
        style="
          grid-column:1/-1;
          text-align:center;
          padding:40px;
        "
      >
        <div
          style="font-size:48px"
        >
          📦
        </div>

        <h3>
          No products available
        </h3>

        <p>
          Please check again later.
        </p>
      </div>
    `;

    return;
  }

  container.innerHTML =
    visibleProducts
      .map(
        product => {

          return `
            <div
              class="card product-card"
            >

              <div
                class="product-emoji"
              >
                ${getProductVisual(
                  product
                )}
              </div>

              <h3>
                ${escapeHtml(
                  product.name
                )}
              </h3>

              <div
                class="muted"
              >
                ${escapeHtml(
                  product.category
                )}
              </div>

              <div
                class="product-bottom"
              >

                <strong>
                  ${formatMoney(
                    product.price
                  )}
                  EGP
                </strong>

                <button
                  class="add-btn"
                  onclick="addToCart('${escapeJs(
                    product.productId
                  )}')"
                >
                  +
                </button>

              </div>

            </div>
          `;
        }
      )
      .join("");
}


/* =========================================================
   CART
========================================================= */

function findProduct(
  productId
) {

  return products.find(
    product =>
      String(
        product.productId
      ) ===
      String(productId)
  );
}


function addToCart(
  productId
) {

  const product =
    findProduct(
      productId
    );

  if (!product) {

    toast(
      "Product not found."
    );

    return;
  }

  const existing =
    cart.find(
      item =>
        String(
          item.productId
        ) ===
        String(productId)
    );

  if (existing) {

    existing.qty =
      Number(
        existing.qty || 0
      ) + 1;

  } else {

    cart.push({

      productId:
        product.productId,

      id:
        product.productId,

      name:
        product.name,

      product:
        product.name,

      price:
        Number(
          product.price || 0
        ),

      qty:
        1,

      emoji:
        product.emoji || "",

      image:
        product.image || ""
    });
  }

  saveCart();

  renderCart();

  updateCartBadges();

  toast(
    product.name +
    " added to cart."
  );
}


function changeCartQty(
  productId,
  delta
) {

  const item =
    cart.find(
      entry =>
        String(
          entry.productId
        ) ===
        String(productId)
    );

  if (!item) {

    return;
  }

  item.qty =
    Number(
      item.qty || 0
    ) +
    Number(delta || 0);

  if (
    item.qty <= 0
  ) {

    cart =
      cart.filter(
        entry =>
          String(
            entry.productId
          ) !==
          String(productId)
      );
  }

  saveCart();

  renderCart();

  updateCartBadges();
}


function cartSubtotal() {

  return cart.reduce(
    (
      total,
      item
    ) => {

      return (
        total +
        Number(
          item.price || 0
        ) *
        Number(
          item.qty || 0
        )
      );

    },
    0
  );
}


function cartDeliveryFee() {

  /*
   * Customer delivery charge.
   */
  return 5;
}


function cartTotal() {

  return (
    cartSubtotal() +
    cartDeliveryFee()
  );
}


function updateCartBadges() {

  const count =
    cart.reduce(
      (
        total,
        item
      ) =>
        total +
        Number(
          item.qty || 0
        ),
      0
    );

  const elements =
    [
      $("cartCount"),
      $("menuCartCount")
    ];

  elements.forEach(
    element => {

      if (!element) {

        return;
      }

      element.textContent =
        String(count);
    }
  );
}


function renderCart() {

  const container =
    $("cartItems");

  if (!container) {

    updateCartBadges();

    return;
  }

  if (
    cart.length === 0
  ) {

    container.innerHTML = `
      <div
        style="
          text-align:center;
          padding:30px;
        "
      >
        <div
          style="font-size:48px"
        >
          🛒
        </div>

        <h3>
          Your cart is empty
        </h3>
      </div>
    `;

  } else {

    container.innerHTML =
      cart
        .map(
          item => {

            return `
              <div
                class="cart-row"
              >

                <div
                  class="cart-row-left"
                >

                  <div
                    style="
                      font-size:32px;
                    "
                  >
                    ${getProductVisual(
                      item
                    )}
                  </div>

                  <div>

                    <strong>
                      ${escapeHtml(
                        item.name
                      )}
                    </strong>

                    <div
                      class="muted"
                    >
                      ${formatMoney(
                        item.price
                      )}
                      EGP
                    </div>

                  </div>

                </div>

                <div
                  class="quantity-control"
                >

                  <button
                    onclick="changeCartQty(
                      '${escapeJs(
                        item.productId
                      )}',
                      -1
                    )"
                  >
                    −
                  </button>

                  <span>
                    ${Number(
                      item.qty || 0
                    )}
                  </span>

                  <button
                    onclick="changeCartQty(
                      '${escapeJs(
                        item.productId
                      )}',
                      1
                    )"
                  >
                    +
                  </button>

                </div>

              </div>
            `;
          }
        )
        .join("");
  }

  const subtotal =
    $("cartSubtotal");

  if (subtotal) {

    subtotal.textContent =
      formatMoney(
        cartSubtotal()
      ) +
      " EGP";
  }

  const delivery =
    $("cartDelivery");

  if (delivery) {

    delivery.textContent =
      formatMoney(
        cartDeliveryFee()
      ) +
      " EGP";
  }

  const total =
    $("cartTotal");

  if (total) {

    total.textContent =
      formatMoney(
        cartTotal()
      ) +
      " EGP";
  }

  updateCartBadges();
}


function openCart() {

  const drawer =
    $("cartDrawer");

  if (!drawer) {

    return;
  }

  drawer.classList.add(
    "open"
  );

  renderCart();
}


function closeCart() {

  const drawer =
    $("cartDrawer");

  if (!drawer) {

    return;
  }

  drawer.classList.remove(
    "open"
  );
}


/* =========================================================
   CHECKOUT
========================================================= */

function renderCheckout() {

  const container =
    $("checkoutItems");

  if (container) {

    container.innerHTML =
      cart
        .map(
          item => {

            return `
              <div
                class="checkout-item"
              >

                <span>
                  ${Number(
                    item.qty || 0
                  )}
                  ×
                  ${escapeHtml(
                    item.name
                  )}
                </span>

                <strong>
                  ${formatMoney(
                    Number(
                      item.price || 0
                    ) *
                    Number(
                      item.qty || 0
                    )
                  )}
                  EGP
                </strong>

              </div>
            `;
          }
        )
        .join("");
  }

  const subtotal =
    $("checkoutSubtotal");

  if (subtotal) {

    subtotal.textContent =
      formatMoney(
        cartSubtotal()
      ) +
      " EGP";
  }

  const delivery =
    $("checkoutDelivery");

  if (delivery) {

    delivery.textContent =
      formatMoney(
        cartDeliveryFee()
      ) +
      " EGP";
  }

  const total =
    $("checkoutTotal");

  if (total) {

    total.textContent =
      formatMoney(
        cartTotal()
      ) +
      " EGP";
  }

  if (customer) {

    const name =
      $("customerName");

    if (name) {

      name.value =
        customer.name || "";
    }

    const phone =
      $("customerPhone");

    if (phone) {

      phone.value =
        customer.phone || "";
    }

    const building =
      $("buildingNumber");

    if (building) {

      building.value =
        customer.buildingNumber ||
        "";
    }

    const apartment =
      $("apartmentNumber");

    if (apartment) {

      apartment.value =
        customer.apartmentNumber ||
        "";
    }
  }
}


function getCheckoutPayload() {

  const name =
    cleanValue(
      $("customerName") &&
      $("customerName").value
    );

  const phone =
    normalizePhone(
      $("customerPhone") &&
      $("customerPhone").value
    );

  const buildingNumber =
    cleanValue(
      $("buildingNumber") &&
      $("buildingNumber").value
    );

  const apartmentNumber =
    cleanValue(
      $("apartmentNumber") &&
      $("apartmentNumber").value
    );

  return {

    name,

    phone,

    buildingNumber,

    apartmentNumber,

    deliverySlot:
      selectedSlot || "",

    items:
      cart.map(
        item => {

          return {

            productId:
              item.productId,

            id:
              item.productId,

            product:
              item.name,

            name:
              item.name,

            price:
              Number(
                item.price || 0
              ),

            quantity:
              Number(
                item.qty || 0
              ),

            qty:
              Number(
                item.qty || 0
              ),

            total:
              Number(
                item.price || 0
              ) *
              Number(
                item.qty || 0
              )
          };
        }
      ),

    subtotal:
      cartSubtotal(),

    deliveryFee:
      cartDeliveryFee(),

    total:
      cartTotal(),

    userId:
      getCustomerUserId()
  };
}


function validateCheckout(
  payload
) {

  if (!payload.name) {

    toast(
      "Please enter your name."
    );

    return false;
  }

  if (!payload.phone) {

    toast(
      "Please enter your phone number."
    );

    return false;
  }

  if (
    !/^01\d{9}$/.test(
      payload.phone
    )
  ) {

    toast(
      "Please enter a valid Egyptian mobile number."
    );

    return false;
  }

  if (
    !payload.buildingNumber
  ) {

    toast(
      "Please enter the building number."
    );

    return false;
  }

  if (
    !payload.apartmentNumber
  ) {

    toast(
      "Please enter the apartment number."
    );

    return false;
  }

  if (
    !payload.deliverySlot
  ) {

    toast(
      "Please select a delivery slot."
    );

    return false;
  }

  if (
    !Array.isArray(
      payload.items
    ) ||
    payload.items.length === 0
  ) {

    toast(
      "Your cart is empty."
    );

    return false;
  }

  return true;
}


/* =========================================================
   DELIVERY SLOTS
========================================================= */

function setupDeliverySlots() {

  const container =
    $("deliverySlots");

  if (!container) {

    return;
  }

  const slots = [
    "10:00 AM–12:00 PM",
    "12:00–2:00 PM",
    "2:00–4:00 PM",
    "4:00–6:00 PM",
    "6:00–8:00 PM"
  ];

  container.innerHTML =
    slots
      .map(
        slot => {

          const active =
            selectedSlot ===
            slot;

          return `
            <button
              type="button"
              class="slot-btn ${
                active
                  ? "active"
                  : ""
              }"
              onclick="selectSlot('${escapeJs(
                slot
              )}')"
            >
              🚚
              ${escapeHtml(
                slot
              )}
            </button>
          `;
        }
      )
      .join("");
}


function selectSlot(
  slot
) {

  selectedSlot =
    slot;

  setupDeliverySlots();
}


/* =========================================================
   CREATE ORDER
========================================================= */

async function submitOrder() {

  const payload =
    getCheckoutPayload();

  if (
    !validateCheckout(
      payload
    )
  ) {

    return;
  }

  const button =
    $("placeOrderBtn");

  if (button) {

    button.disabled =
      true;

    button.dataset.originalText =
      button.textContent;

    button.textContent =
      "Placing order...";
  }

  try {

    /*
     * Save customer locally before creating order.
     */

    customer = {

      ...(customer || {}),

      name:
        payload.name,

      phone:
        payload.phone,

      buildingNumber:
        payload.buildingNumber,

      apartmentNumber:
        payload.apartmentNumber,

      userId:
        getCustomerUserId()
    };

    saveCustomer();

    const response =
      await postToGoogleScript(
        {
          action:
            "createOrder",

          ...payload
        },
        {
          timeout:
            30000
        }
      );

    console.log(
      "Create order response:",
      response
    );

    if (
      !response ||
      response.ok !== true
    ) {

      throw new Error(
        response &&
        response.error
          ? response.error
          : "Unable to place order."
      );
    }

    /*
     * Capture User ID returned by backend.
     */

    if (
      response.userId
    ) {

      customer.userId =
        cleanValue(
          response.userId
        );

      saveUserId(
        customer.userId
      );

      saveCustomer();
    }

    /*
     * Build the confirmed order from the server response.
     *
     * This avoids waiting for another Google Sheets request.
     */

    const orderId =
      cleanValue(
        response.orderId ||
        response.order &&
        response.order.orderId
      );

    const serverTotal =
      Number(
        response.total ??
        payload.total ??
        0
      );

    lastOrder = {

      orderId,

      id:
        orderId,

      userId:
        customer.userId || "",

      name:
        payload.name,

      phone:
        payload.phone,

      buildingNumber:
        payload.buildingNumber,

      apartmentNumber:
        payload.apartmentNumber,

      deliverySlot:
        payload.deliverySlot,

      status:
        "Active",

      createdAt:
        new Date().toISOString(),

      total:
        serverTotal,

      items:
        payload.items.map(
          item => ({
            ...item
          })
        )
    };

    /*
     * The create-order response is already confirmed by the server.
     * Show this order immediately. A later background sync can still
     * reconcile the list with Google Sheets.
     */

    activeOrders = [
      lastOrder
    ];

    saveOrders();

    cart = [];

    saveCart();

    updateCartBadges();

    renderCart();

    show("success");

    renderSuccess();

    /*
     * Do not wait 1.5 seconds and then make another blocking
     * request. The order is already available from the create
     * response. Active Orders will reconcile in the background
     * when the customer opens the page.
     */

  } catch (error) {

    console.error(
      "Create order error:",
      error
    );

    toast(
      error.message ||
      "Unable to place order."
    );

  } finally {

    if (button) {

      button.disabled =
        false;

      button.textContent =
        button.dataset.originalText ||
        "Place order";
    }
  }
}


/* =========================================================
   SUCCESS PAGE
========================================================= */

function renderSuccess() {

  if (!lastOrder) {

    return;
  }

  const id =
    $("successOrderId");

  if (id) {

    id.textContent =
      lastOrder.orderId ||
      "Order confirmed";
  }

  const total =
    $("successTotal");

  if (total) {

    total.textContent =
      formatMoney(
        lastOrder.total
      ) +
      " EGP";
  }

  const slot =
    $("successSlot");

  if (slot) {

    slot.textContent =
      lastOrder.deliverySlot ||
      "";
  }
}


/* =========================================================
   ACTIVE ORDERS
========================================================= */

async function syncCustomerOrders() {

  const userId =
    await ensureCustomerUserId();

  if (!userId) {

    console.warn(
      "Cannot sync orders: User ID is missing."
    );

    activeOrders = [];

    saveOrders();

    renderOrders();

    return [];
  }

  console.log(
    "Syncing orders for User ID:",
    userId
  );

  try {

    const response =
      await callGoogleScript(
        {
          action:
            "orders",

          userId:
            userId
        },
        {
          timeout:
            30000
        }
      );

    console.log(
      "Orders API response:",
      response
    );

    if (
      !response ||
      response.ok !== true
    ) {

      throw new Error(
        response &&
        response.error
          ? response.error
          : "Unable to load orders."
      );
    }

    const orders =
      Array.isArray(
        response.orders
      )
        ? response.orders
        : [];

    /*
     * Google Sheets is the source of truth.
     *
     * IMPORTANT:
     * Do NOT fall back to old local orders if the API returns
     * an empty array.
     *
     * If the sheet says there are zero active orders, there are
     * zero active orders.
     */

    activeOrders =
      orders.map(
        normalizeOrder
      );

    saveOrders();

    renderOrders();

    updateOrdersBadge();

    return activeOrders;

  } catch (error) {

    console.error(
      "Sync customer orders error:",
      error
    );

    /*
     * Keep the current displayed state on a temporary network
     * failure rather than replacing it with an empty array.
     */

    return activeOrders;
  }
}


function normalizeOrder(
  order
) {

  if (
    !order ||
    typeof order !== "object"
  ) {

    return null;
  }

  const items =
    Array.isArray(
      order.items
    )
      ? order.items
      : [];

  return {

    ...order,

    orderId:
      cleanValue(
        order.orderId ??
        order.id ??
        order["Order ID"]
      ),

    id:
      cleanValue(
        order.id ??
        order.orderId ??
        order["Order ID"]
      ),

    userId:
      cleanValue(
        order.userId ??
        order["User ID"]
      ),

    name:
      cleanValue(
        order.name ??
        order.Name
      ),

    phone:
      normalizePhone(
        order.phone ??
        order.Phone
      ),

    buildingNumber:
      cleanValue(
        order.buildingNumber ??
        order["Building Number"]
      ),

    apartmentNumber:
      cleanValue(
        order.apartmentNumber ??
        order["Apartment Number"]
      ),

    address:
      cleanValue(
        order.address ??
        order.Address
      ),

    deliverySlot:
      cleanValue(
        order.deliverySlot ??
        order["Delivery Slot"]
      ),

    status:
      cleanValue(
        order.status ??
        order.Status
      ) ||
      "Active",

    total:
      Number(
        order.total ??
        order.Total ??
        0
      ),

    createdAt:
      order.createdAt ??
      order["Created At"] ??
      "",

    items:
      items.map(
        item => {

          return {

            ...item,

            productId:
              cleanValue(
                item.productId ??
                item.id ??
                item["Product ID"]
              ),

            name:
              cleanValue(
                item.name ??
                item.product ??
                item.Product
              ),

            qty:
              Number(
                item.qty ??
                item.quantity ??
                item.Quantity ??
                0
              ),

            quantity:
              Number(
                item.quantity ??
                item.qty ??
                item.Quantity ??
                0
              ),

            price:
              Number(
                item.price ??
                item["Unit Price"] ??
                item.Price ??
                0
              ),

            total:
              Number(
                item.total ??
                item["Line Total"] ??
                item.Total ??
                0
              )
          };
        }
      )
  };
}


function renderOrders() {

  const container =
    $("ordersList");

  if (!container) {

    updateOrdersBadge();

    return;
  }

  const orders =
    Array.isArray(
      activeOrders
    )
      ? activeOrders.filter(
          Boolean
        )
      : [];

  if (
    orders.length === 0
  ) {

    container.innerHTML = `
      <div
        class="card"
        style="
          text-align:center;
          padding:40px;
        "
      >

        <div
          style="
            font-size:48px;
          "
        >
          📦
        </div>

        <h3>
          No active orders
        </h3>

        <p
          class="muted"
        >
          Your confirmed orders will appear here.
        </p>

        <button
          class="primary-btn"
          id="orderFromEmpty"
          onclick="goToMenuFromOrders()"
        >
          Order for tomorrow
        </button>

      </div>
    `;

    updateOrdersBadge();

    return;
  }

  container.innerHTML =
    orders
      .map(
        order =>
          renderOrderCard(
            order
          )
      )
      .join("");

  updateOrdersBadge();
}


function renderOrderCard(
  order
) {

  const orderId =
    cleanValue(
      order.orderId ||
      order.id
    );

  const status =
    cleanValue(
      order.status
    ) ||
    "Active";

  const items =
    Array.isArray(
      order.items
    )
      ? order.items
      : [];

  const itemsHtml =
    items.length
      ? items
          .map(
            item => {

              const qty =
                Number(
                  item.qty ??
                  item.quantity ??
                  0
                );

              const lineTotal =
                Number(
                  item.total ??
                  (
                    Number(
                      item.price || 0
                    ) *
                    qty
                  )
                );

              return `
                <div
                  class="order-item-row"
                >

                  <span>
                    ${qty}
                    ×
                    ${escapeHtml(
                      item.name || ""
                    )}
                  </span>

                  <span>
                    ${formatMoney(
                      lineTotal
                    )}
                    EGP
                  </span>

                </div>
              `;
            }
          )
          .join("")
      : `
        <div
          class="muted"
        >
          Order details unavailable.
        </div>
      `;

  const created =
    formatOrderDate(
      order.createdAt
    );

  const delivery =
    cleanValue(
      order.deliverySlot
    );

  const statusClass =
    status.toLowerCase() ===
    "active"
      ? "active"
      : "inactive";

  return `
    <div
      class="card order-card"
    >

      <div
        class="order-card-header"
      >

        <div>

          <h3>
            ${escapeHtml(
              orderId
            )}
          </h3>

          <div
            class="muted"
          >
            ${
              created
                ? "Placed " +
                  escapeHtml(
                    created
                  )
                : "Order"
            }
          </div>

        </div>

        <span
          class="status-badge ${statusClass}"
        >
          ${escapeHtml(
            status.toUpperCase()
          )}
        </span>

      </div>

      <div
        class="order-items"
      >
        ${itemsHtml}
      </div>

      <div
        class="order-total-row"
      >

        <strong>
          Total
        </strong>

        <strong>
          ${formatMoney(
            Number(
              order.total || 0
            )
          )}
          EGP
        </strong>

      </div>

      ${
        delivery
          ? `
            <div
              class="delivery-slot"
            >
              🚚
              ${escapeHtml(
                delivery
              )}
            </div>
          `
          : ""
      }

      ${
        status.toLowerCase() ===
        "active"
          ? `
            <button
              class="cancel-order-btn"
              onclick="cancelOrder('${escapeJs(
                orderId
              )}')"
            >
              Cancel order
            </button>
          `
          : ""
      }

    </div>
  `;
}


function updateOrdersBadge() {

  const count =
    Array.isArray(
      activeOrders
    )
      ? activeOrders.filter(
          order =>
            order &&
            String(
              order.status || ""
            ).toLowerCase() ===
            "active"
        ).length
      : 0;

  const badges =
    [
      $("ordersCount"),
      $("orderCount")
    ];

  badges.forEach(
    badge => {

      if (!badge) {

        return;
      }

      badge.textContent =
        String(count);
    }
  );
}


/* =========================================================
   CANCEL ORDER
========================================================= */

async function cancelOrder(
  orderId
) {

  const target =
    cleanValue(
      orderId
    );

  if (!target) {

    toast(
      "Invalid order."
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

  /*
   * Optimistically remove the order from the UI.
   *
   * The backend remains the source of truth.
   */

  const previousOrders =
    activeOrders.slice();

  activeOrders =
    activeOrders.filter(
      order =>
        cleanValue(
          order.orderId ||
          order.id
        ) !==
        target
    );

  saveOrders();

  renderOrders();

  updateOrdersBadge();

  try {

    const userId =
      await ensureCustomerUserId();

    const response =
      await postToGoogleScript(
        {
          action:
            "cancelOrder",

          orderId:
            target,

          userId:
            userId
        },
        {
          timeout:
            30000
        }
      );

    console.log(
      "Cancel order response:",
      response
    );

    if (
      !response ||
      response.ok !== true
    ) {

      throw new Error(
        response &&
        response.error
          ? response.error
          : "Unable to cancel order."
      );
    }

    /*
     * The backend is now the source of truth.
     * Refresh once in the background to verify the cancellation.
     */

    syncCustomerOrders().catch(
      error => {

        console.warn(
          "Post-cancellation sync failed:",
          error
        );
      }
    );

    toast(
      "Order cancelled successfully."
    );

  } catch (error) {

    console.error(
      "Cancel order error:",
      error
    );

    /*
     * Restore the previous UI state if the cancellation
     * request itself failed.
     */

    activeOrders =
      previousOrders;

    saveOrders();

    renderOrders();

    updateOrdersBadge();

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

        show(
          "home"
        );
      };
  }

  const start =
    $("startBtn");

  if (start) {

    start.onclick =
      async () => {

        show(
          "menu"
        );

        if (
          !products.length
        ) {

          $("products").innerHTML = `
            <div
              class="card"
              style="
                grid-column:1/-1;
                text-align:center;
                padding:30px;
              "
            >

              <div
                style="
                  font-size:38px
                "
              >
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

        if (
          !cart.length
        ) {

          toast(
            "Your cart is empty."
          );

          return;
        }

        closeCart();

        selectedSlot =
          selectedSlot || "";

        renderCheckout();

        show(
          "checkout"
        );
      };
  }

  const back =
    $("back");

  if (back) {

    back.onclick =
      () => {

        show(
          "menu"
        );

        renderCats();
        renderProducts();
      };
  }

  const ordersButton =
    $("ordersBtn");

  if (ordersButton) {

    ordersButton.onclick =
      () => {

        show(
          "orders"
        );

        /*
         * Show the current in-memory/server-confirmed state
         * immediately. Reconcile with Google Sheets in the
         * background instead of blocking the page.
         */

        renderOrders();

        syncCustomerOrders().catch(
          error => {

            console.warn(
              "Background order sync failed:",
              error
            );
          }
        );
      };
  }

  const ordersBack =
    $("ordersBackBtn");

  if (ordersBack) {

    ordersBack.onclick =
      () => {

        show(
          "home"
        );
      };
  }

  const orderEmpty =
    $("orderFromEmpty");

  if (orderEmpty) {

    orderEmpty.onclick =
      async () => {

        show(
          "menu"
        );

        if (
          !products.length
        ) {

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

        show(
          "menu"
        );

        if (
          !products.length
        ) {

          await loadProducts();
        }

        renderCats();
        renderProducts();
      };
  }
}


function goToMenuFromOrders() {

  show(
    "menu"
  );

  if (
    !products.length
  ) {

    loadProducts();
  }

  renderCats();
  renderProducts();
}


/* =========================================================
   CHECKOUT FORM
========================================================= */

function setupCheckoutForm() {

  const form =
    $("checkoutForm");

  if (!form) {

    return;
  }

  form.addEventListener(
    "submit",
    event => {

      event.preventDefault();

      submitOrder();
    }
  );

  setupDeliverySlots();
}


/* =========================================================
   INSTALL PROMPT
========================================================= */

let deferredInstallPrompt =
  null;


function setupInstallPrompt() {

  window.addEventListener(
    "beforeinstallprompt",
    event => {

      event.preventDefault();

      deferredInstallPrompt =
        event;

      const button =
        $("installBtn");

      if (button) {

        button.style.display =
          "block";

        button.onclick =
          async () => {

            if (
              !deferredInstallPrompt
            ) {

              return;
            }

            deferredInstallPrompt
              .prompt();

            await deferredInstallPrompt
              .userChoice;

            deferredInstallPrompt =
              null;

            button.style.display =
              "none";
          };
      }
    }
  );
}


/* =========================================================
   VIEW MANAGEMENT
========================================================= */

function show(
  view
) {

  currentView =
    view;

  const views =
    [
      "home",
      "menu",
      "checkout",
      "success",
      "orders"
    ];

  views.forEach(
    name => {

      const element =
        $(
          name +
          "View"
        );

      if (!element) {

        return;
      }

      if (
        name ===
        view
      ) {

        element.style.display =
          "";

      } else {

        element.style.display =
          "none";
      }
    }
  );

  window.scrollTo(
    {
      top: 0,
      behavior: "instant"
    }
  );

  if (
    view ===
    "menu"
  ) {

    renderCats();
    renderProducts();
  }

  if (
    view ===
    "checkout"
  ) {

    renderCheckout();
  }

  if (
    view ===
    "orders"
  ) {

    renderOrders();
  }
}


/* =========================================================
   TOAST
========================================================= */

function toast(
  message
) {

  const existing =
    document.querySelector(
      ".toast"
    );

  if (existing) {

    existing.remove();
  }

  const element =
    document.createElement(
      "div"
    );

  element.className =
    "toast";

  element.textContent =
    message;

  document.body.appendChild(
    element
  );

  requestAnimationFrame(
    () => {

      element.classList.add(
        "show"
      );
    }
  );

  setTimeout(
    () => {

      element.classList.remove(
        "show"
      );

      setTimeout(
        () => {

          element.remove();

        },
        250
      );

    },
    3000
  );
}


/* =========================================================
   FORMATTING
========================================================= */

function formatMoney(
  value
) {

  const number =
    Number(value || 0);

  return number.toLocaleString(
    "en-US",
    {
      maximumFractionDigits:
        2
    }
  );
}


function formatOrderDate(
  value
) {

  if (!value) {

    return "";
  }

  const date =
    new Date(
      value
    );

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {

    return cleanValue(
      value
    );
  }

  return date.toLocaleDateString(
    "en-US",
    {
      month:
        "short",

      day:
        "numeric",

      year:
        "numeric"
    }
  );
}


/* =========================================================
   ESCAPING
========================================================= */

function escapeHtml(
  value
) {

  return cleanValue(
    value
  )
    .replace(
      /&/g,
      "&amp;"
    )
    .replace(
      /</g,
      "&lt;"
    )
    .replace(
      />/g,
      "&gt;"
    )
    .replace(
      /"/g,
      "&quot;"
    )
    .replace(
      /'/g,
      "&#039;"
    );
}


function escapeJs(
  value
) {

  return cleanValue(
    value
  )
    .replace(
      /\\/g,
      "\\\\"
    )
    .replace(
      /'/g,
      "\\'"
    )
    .replace(
      /"/g,
      '\\"'
    )
    .replace(
      /\n/g,
      "\\n"
    )
    .replace(
      /\r/g,
      "\\r"
    );
}


/* =========================================================
   CUSTOMER PROFILE
========================================================= */

function loadSavedCustomer() {

  const saved =
    loadCustomer();

  if (
    saved &&
    typeof saved ===
      "object"
  ) {

    customer =
      saved;

    /*
     * Normalize old stored phone numbers.
     */

    if (
      customer.phone
    ) {

      customer.phone =
        normalizePhone(
          customer.phone
        );
    }

    /*
     * Restore User ID.
     */

    if (
      !customer.userId
    ) {

      const stored =
        getStoredUserId();

      if (stored) {

        customer.userId =
          stored;
      }
    }

    saveCustomer();

    return customer;
  }

  customer =
    null;

  return null;
}


function clearCustomerLocalData() {

  customer =
    null;

  activeOrders =
    [];

  try {

    localStorage.removeItem(
      STORAGE_KEYS.customer
    );

    localStorage.removeItem(
      STORAGE_KEYS.userId
    );

    localStorage.removeItem(
      STORAGE_KEYS.orders
    );

  } catch (error) {

    console.warn(
      "Unable to clear customer data:",
      error
    );
  }

  updateOrdersBadge();
}


/* =========================================================
   INIT
========================================================= */

async function init() {

  console.log(
    "MoharamBake app starting..."
  );

  /*
   * Load local state immediately.
   *
   * These values are only used to make the UI responsive.
   * Google Sheets remains the source of truth for orders.
   */

  customer =
    loadSavedCustomer();

  cart =
    loadCart();

  activeOrders =
    loadOrders();

  updateCartBadges();
  updateOrdersBadge();

  setupNavigation();
  setupCheckoutForm();
  setupInstallPrompt();

  renderCart();
  renderOrders();

  /*
   * Load products in the background.
   *
   * This prevents the entire app startup from waiting on
   * Google Apps Script.
   */

  loadProducts().catch(
    error => {

      console.warn(
        "Background product load failed:",
        error
      );
    }
  );

  /*
   * Retrieve active orders ONLY by User ID, but do it in the
   * background so the app does not wait for Google Apps Script
   * before becoming usable.
   */

  if (
    customer &&
    customer.userId
  ) {

    syncCustomerOrders().catch(
      error => {

        console.warn(
          "Startup order sync failed:",
          error
        );
      }
    );
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
    () => {

      init();
    }
  );

} else {

  init();
}
