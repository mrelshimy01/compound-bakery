const SHEET_ID = '1y3FMn3N_sq8GqSjlSpyobkoIdAWINkPyAYPTMYVkpjg';

const SHEETS = {
  ORDERS: 'Orders',
  ITEMS: 'OrderItems',
  CUSTOMERS: 'Customers',
  PRODUCTS: 'Products'
};

function doGet(e) {
  try {
    setupSheets();

    const action = (e && e.parameter && e.parameter.action) || '';
    let result;

    if (action === 'products') {
      result = { ok: true, products: getProducts() };
    } else if (action === 'orders') {
      result = getCustomerOrders(e.parameter.phone || '');
    } else {
      result = {
        ok: true,
        service: 'MoharamBake API',
        version: '2.0'
      };
    }

    return jsonpOrJson(e, result);

  } catch (err) {
    return jsonpOrJson(e, { ok: false, error: String(err) });
  }
}

function doPost(e) {
  try {
    setupSheets();

    const body = JSON.parse((e.postData && e.postData.contents) || '{}');

    if (body.action === 'createOrder') {
      return json(createOrder(body));
    }

    if (body.action === 'cancelOrder') {
      return json(cancelOrder(body));
    }

    return json({ ok: false, error: 'Unknown action' });

  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

/**
 * Run this once manually after pasting the script.
 * It creates the required tabs and headers automatically.
 */
function setupSheets() {
  const ss = SpreadsheetApp.openById(SHEET_ID);

  ensureSheet(ss, SHEETS.ORDERS, [
    'Order ID',
    'Created At',
    'Name',
    'Phone',
    'Address',
    'Delivery Slot',
    'Total',
    'Status'
  ]);

  ensureSheet(ss, SHEETS.ITEMS, [
    'Order ID',
    'Product ID',
    'Product',
    'Qty',
    'Unit Price',
    'Line Total'
  ]);

  ensureSheet(ss, SHEETS.CUSTOMERS, [
    'Name',
    'Phone',
    'Address',
    'Updated At'
  ]);

  ensureSheet(ss, SHEETS.PRODUCTS, [
    'ID',
    'Product',
    'Category',
    'Price',
    'Emoji',
    'Active'
  ]);

  // Add starter products whenever Products has no product rows.
  const productSheet = ss.getSheetByName(SHEETS.PRODUCTS);
  if (productSheet.getLastRow() < 2) {
    productSheet.getRange(2, 1, 4, 6).setValues([
      [1, 'Baladi Bread', 'Bread', 3, '🥖', true],
      [2, 'Brown Bread', 'Bread', 5, '🍞', true],
      [3, 'Fino', 'Bread', 4, '🥖', true],
      [4, 'Croissant', 'Pastries', 25, '🥐', true]
    ]);
  }
}

function ensureSheet(ss, name, headers) {
  let sh = ss.getSheetByName(name);

  if (!sh) {
    sh = ss.insertSheet(name);
  }

  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.setFrozenRows(1);
  }
}

function getProducts() {
  const sh = SpreadsheetApp
    .openById(SHEET_ID)
    .getSheetByName(SHEETS.PRODUCTS);

  const values = sh.getDataRange().getValues();

  if (values.length < 2) return [];

  const headers = values[0].map(String);

  return values.slice(1)
    .map(row => Object.fromEntries(
      headers.map((header, i) => [header, row[i]])
    ))
    .filter(p => String(p.Active).toUpperCase() !== 'FALSE')
    .filter(p => p.Product)
    .map(p => ({
      id: p.ID,
      name: p.Product,
      category: p.Category || 'Bakery',
      price: Number(p.Price),
      emoji: p.Emoji || '🥖',
      active: true
    }));
}

function createOrder(data) {
  const ss = SpreadsheetApp.openById(SHEET_ID);

  const orders = ss.getSheetByName(SHEETS.ORDERS);
  const items = ss.getSheetByName(SHEETS.ITEMS);
  const customers = ss.getSheetByName(SHEETS.CUSTOMERS);

  const customer = data.customer || {};
  const orderItems = data.items || [];

  if (!customer.name || !customer.phone || !customer.address) {
    return { ok: false, error: 'Customer details are incomplete.' };
  }

  if (!data.slot) {
    return { ok: false, error: 'Delivery slot is required.' };
  }

  if (!orderItems.length) {
    return { ok: false, error: 'Order is empty.' };
  }

  const now = new Date();

  // Milliseconds avoid duplicate order IDs if two orders arrive in the same second.
  const orderId =
    'MB-' +
    Utilities.formatDate(
      now,
      Session.getScriptTimeZone(),
      'yyyyMMdd-HHmmss'
    ) +
    '-' +
    String(now.getMilliseconds()).padStart(3, '0');

  const subtotal = orderItems.reduce(
    (sum, item) =>
      sum + Number(item.price) * Number(item.qty),
    0
  );

  // Fixed delivery fee. This changes only the order-level Total.
  const total = subtotal + 5;

  orders.appendRow([
    orderId,
    now,
    customer.name,
    customer.phone,
    customer.address,
    data.slot,
    total,
    'Active'
  ]);

  orderItems.forEach(item => {
    items.appendRow([
      orderId,
      item.id,
      item.name,
      Number(item.qty),
      Number(item.price),
      Number(item.qty) * Number(item.price)
    ]);
  });

  upsertCustomer(customers, customer);

  return {
    ok: true,
    orderId: orderId,
    total: total
  };
}

function cancelOrder(data) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const orders = ss.getSheetByName(SHEETS.ORDERS);

  // Server-side 10 PM cutoff.
  const now = new Date();
  const cutoff = new Date(now);
  cutoff.setHours(22, 0, 0, 0);

  if (now >= cutoff) {
    return {
      ok: false,
      error: 'Cancellation closes at 10:00 PM.'
    };
  }

  const values = orders.getDataRange().getValues();

  if (values.length < 2) {
    return { ok: false, error: 'Order not found.' };
  }

  const headers = values[0].map(String);

  const orderCol = findCol(headers, ['Order ID', 'OrderId', 'ID']);
  const phoneCol = findCol(headers, ['Phone', 'Mobile', 'Mobile Number']);
  const statusCol = findCol(headers, ['Status']);

  if (orderCol < 0 || statusCol < 0) {
    return {
      ok: false,
      error: 'Orders sheet needs Order ID and Status columns.'
    };
  }

  for (let i = 1; i < values.length; i++) {

    if (String(values[i][orderCol]) !== String(data.orderId)) {
      continue;
    }

    if (
      phoneCol >= 0 &&
      String(values[i][phoneCol]) !== String(data.phone || '')
    ) {
      return {
        ok: false,
        error: 'Order does not belong to this customer.'
      };
    }

    const currentStatus = String(values[i][statusCol] || '');

    if (currentStatus === 'Cancelled') {
      return {
        ok: true,
        message: 'Order already cancelled.'
      };
    }

    if (currentStatus !== 'Active') {
      return {
        ok: false,
        error: 'This order cannot be cancelled.'
      };
    }

    orders
      .getRange(i + 1, statusCol + 1)
      .setValue('Cancelled');

    return {
      ok: true,
      orderId: data.orderId
    };
  }

  return {
    ok: false,
    error: 'Order not found.'
  };
}

function getCustomerOrders(phone) {
  if (!phone) {
    return { ok: true, orders: [] };
  }

  const ss = SpreadsheetApp.openById(SHEET_ID);

  const ordersSheet = ss.getSheetByName(SHEETS.ORDERS);
  const itemsSheet = ss.getSheetByName(SHEETS.ITEMS);

  const orderValues = ordersSheet.getDataRange().getValues();

  if (orderValues.length < 2) {
    return { ok: true, orders: [] };
  }

  const headers = orderValues[0].map(String);

  const orderCol = findCol(headers, ['Order ID', 'OrderId', 'ID']);
  const dateCol = findCol(headers, ['Created At', 'Date', 'Created']);
  const nameCol = findCol(headers, ['Name', 'Customer']);
  const phoneCol = findCol(headers, ['Phone', 'Mobile', 'Mobile Number']);
  const addressCol = findCol(headers, ['Address', 'Building / Apartment']);
  const slotCol = findCol(headers, ['Delivery Slot', 'Slot']);
  const totalCol = findCol(headers, ['Total', 'Amount']);
  const statusCol = findCol(headers, ['Status']);

  const itemData = getOrderItems(itemsSheet);

  const orders = [];

  for (let i = 1; i < orderValues.length; i++) {

    if (
      phoneCol >= 0 &&
      String(orderValues[i][phoneCol]) !== String(phone)
    ) {
      continue;
    }

    const orderId =
      orderCol >= 0
        ? String(orderValues[i][orderCol])
        : '';

    orders.push({
      orderId: orderId,
      date: dateCol >= 0 ? orderValues[i][dateCol] : '',
      name: nameCol >= 0 ? String(orderValues[i][nameCol]) : '',
      phone: String(phone),
      address: addressCol >= 0 ? String(orderValues[i][addressCol]) : '',
      slot: slotCol >= 0 ? String(orderValues[i][slotCol]) : '',
      total: totalCol >= 0 ? Number(orderValues[i][totalCol]) : 0,
      status: statusCol >= 0 ? String(orderValues[i][statusCol]) : '',
      items: itemData[orderId] || []
    });
  }

  return {
    ok: true,
    orders: orders.reverse()
  };
}

function getOrderItems(sh) {
  const values = sh.getDataRange().getValues();

  if (values.length < 2) return {};

  const headers = values[0].map(String);

  const orderCol = findCol(headers, ['Order ID', 'OrderId']);
  const productCol = findCol(headers, ['Product', 'Item']);
  const qtyCol = findCol(headers, ['Qty', 'Quantity']);
  const priceCol = findCol(headers, ['Unit Price', 'Price']);
  const idCol = findCol(headers, ['Product ID', 'ID']);

  const result = {};

  for (let i = 1; i < values.length; i++) {

    const orderId =
      orderCol >= 0
        ? String(values[i][orderCol])
        : '';

    if (!orderId) continue;

    if (!result[orderId]) {
      result[orderId] = [];
    }

    result[orderId].push({
      id: idCol >= 0 ? values[i][idCol] : '',
      name: productCol >= 0 ? String(values[i][productCol]) : '',
      qty: qtyCol >= 0 ? Number(values[i][qtyCol]) : 0,
      price: priceCol >= 0 ? Number(values[i][priceCol]) : 0
    });
  }

  return result;
}

function upsertCustomer(sh, customer) {
  const values = sh.getDataRange().getValues();

  const headers = values[0].map(String);

  const phoneCol = findCol(
    headers,
    ['Phone', 'Mobile', 'Mobile Number']
  );

  const nameCol = findCol(
    headers,
    ['Name', 'Customer']
  );

  const addressCol = findCol(
    headers,
    ['Address', 'Building / Apartment']
  );

  const updatedCol = findCol(
    headers,
    ['Updated At']
  );

  if (phoneCol < 0) return;

  for (let i = 1; i < values.length; i++) {

    if (
      String(values[i][phoneCol]) !==
      String(customer.phone)
    ) {
      continue;
    }

    if (nameCol >= 0) {
      sh.getRange(i + 1, nameCol + 1)
        .setValue(customer.name);
    }

    if (addressCol >= 0) {
      sh.getRange(i + 1, addressCol + 1)
        .setValue(customer.address);
    }

    if (updatedCol >= 0) {
      sh.getRange(i + 1, updatedCol + 1)
        .setValue(new Date());
    }

    return;
  }

  const row = new Array(headers.length).fill('');

  if (nameCol >= 0) row[nameCol] = customer.name;
  row[phoneCol] = customer.phone;
  if (addressCol >= 0) row[addressCol] = customer.address;
  if (updatedCol >= 0) row[updatedCol] = new Date();

  sh.appendRow(row);
}

function findCol(headers, names) {
  const lower = headers.map(
    x => x.toLowerCase().trim()
  );

  for (const name of names) {
    const index =
      lower.indexOf(name.toLowerCase());

    if (index >= 0) return index;
  }

  return -1;
}

function jsonpOrJson(e, object) {
  const callback = e && e.parameter
    ? String(e.parameter.callback || '')
    : '';

  // Only allow simple JS callback names generated by the app.
  if (callback && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(callback)) {
    return ContentService
      .createTextOutput(
        callback + '(' + JSON.stringify(object) + ');'
      )
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }

  return json(object);
}

function json(object) {
  return ContentService
    .createTextOutput(JSON.stringify(object))
    .setMimeType(ContentService.MimeType.JSON);
}
