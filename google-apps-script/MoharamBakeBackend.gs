/* =========================================================
   MOHARAMBAKE GOOGLE APPS SCRIPT BACKEND
   =========================================================

   Sheets:

     Products
     Orders
     OrderItems
     Customers

   Orders:

     Order ID
     Created At
     Name
     Phone
     Address
     Delivery Slot
     Total
     Status
     Update
     User ID

   OrderItems:

     Order ID
     Product ID
     Product
     Price
     Quantity
     Total
     Status

   IMPORTANT:

   OrderItems.Status is synchronized automatically with
   Orders.Status.

   Example:

   Orders:
     MB-123 | Active

   OrderItems:
     MB-123 | Item 1 | Active
     MB-123 | Item 2 | Active

   Change Orders.Status to:

     Completed

   Automatically:

   OrderItems:
     MB-123 | Item 1 | Completed
     MB-123 | Item 2 | Completed

   Then the non-active OrderItems are deleted.

========================================================= */


/* =========================================================
   CONFIG
========================================================= */

const CONFIG = {

  SPREADSHEET_ID:
    SpreadsheetApp
      .getActiveSpreadsheet()
      .getId(),

  SHEETS: {

    PRODUCTS:
      "Products",

    ORDERS:
      "Orders",

    ORDER_ITEMS:
      "OrderItems",

    CUSTOMERS:
      "Customers"
  },

  ACTIVE_STATUS:
    "Active",

  CANCELLED_STATUS:
    "Cancelled",

  /*
   * Fixed delivery fee added to every order's total at checkout.
   */
  DELIVERY_FEE:
    5,

  /*
   * Same-day ("tonight") orders must be placed, and can only be
   * cancelled, before this hour (24h, script timezone). After this
   * hour same-day delivery is no longer offered for that day.
   */
  SAME_DAY_CUTOFF_HOUR:
    17,

  /*
   * Next-day orders can be cancelled any time on the day they were
   * placed, up to the last minute before midnight (23:59). Once the
   * calendar date changes, cancellation closes permanently for that
   * order - see the same-calendar-day check in cancelOrder().
   */
  NEXT_DAY_CANCEL_CUTOFF_HOUR:
    23,

  NEXT_DAY_CANCEL_CUTOFF_MINUTE:
    59,

  DELIVERY_TYPES: {

    SAME_DAY:
      "Same Day",

    NEXT_DAY:
      "Next Day"
  },

  USER_ID_PREFIX:
    "MBU-",

  USER_ID_LENGTH:
    20,

  TIMEZONE:
    "Africa/Cairo"
};


/* =========================================================
   BASIC HELPERS
========================================================= */

/*
 * Memoized per execution. SpreadsheetApp.openById() is a real network
 * round trip (often 300-800ms on its own) - the old code called this
 * indirectly 5-10+ times per request (once per getSheet() call). We
 * only ever need it once per execution.
 */
var _CACHED_SPREADSHEET_ = null;

function getSpreadsheet() {

  if (!_CACHED_SPREADSHEET_) {

    _CACHED_SPREADSHEET_ =
      SpreadsheetApp.openById(
        CONFIG.SPREADSHEET_ID
      );
  }

  return _CACHED_SPREADSHEET_;
}


function getSheet(name) {

  const spreadsheet =
    getSpreadsheet();

  let sheet =
    spreadsheet.getSheetByName(
      name
    );

  if (!sheet) {

    sheet =
      spreadsheet.insertSheet(
        name
      );
  }

  return sheet;
}


function jsonResponse(data) {

  return ContentService
    .createTextOutput(
      JSON.stringify(data)
    )
    .setMimeType(
      ContentService.MimeType.JSON
    );
}


function cleanValue(value) {

  if (
    value === null ||
    value === undefined
  ) {

    return "";
  }

  return String(
    value
  ).trim();
}


function parseNumber(value) {

  if (
    typeof value ===
    "number"
  ) {

    return value;
  }

  const number =
    parseFloat(
      String(
        value || ""
      ).replace(
        /[^\d.-]/g,
        ""
      )
    );

  return isNaN(number)
    ? 0
    : number;
}


/* =========================================================
   HEADERS
========================================================= */

function getHeaders(sheet) {

  if (
    sheet.getLastColumn() === 0
  ) {

    return [];
  }

  return sheet
    .getRange(
      1,
      1,
      1,
      sheet.getLastColumn()
    )
    .getValues()[0]
    .map(
      function(value) {

        return String(
          value || ""
        ).trim();
      }
    );
}


function ensureHeader(
  sheet,
  header
) {

  const headers =
    getHeaders(
      sheet
    );

  const existingIndex =
    headers.findIndex(
      function(value) {

        return (
          String(value)
            .trim()
            .toLowerCase() ===
          String(header)
            .trim()
            .toLowerCase()
        );
      }
    );

  if (
    existingIndex >= 0
  ) {

    return existingIndex;
  }

  const newColumn =
    headers.length + 1;

  sheet
    .getRange(
      1,
      newColumn
    )
    .setValue(
      header
    );

  return newColumn - 1;
}


/*
 * Looks up several header names on a sheet in a SINGLE round trip,
 * instead of calling ensureHeader() once per column (each of which
 * was its own separate getHeaders() API call - the old createOrder/
 * upsertCustomer/saveOrderItems chained 5-10 of these back to back,
 * which alone accounted for several seconds of order-placing time).
 *
 * Any header that's genuinely missing gets appended in one batched
 * write. Returns { "Header Name": columnIndex, ... } (0-based).
 */
function getHeaderIndexes(
  sheet,
  requiredHeaders
) {

  let headers =
    getHeaders(
      sheet
    );

  const missing =
    requiredHeaders.filter(
      function(name) {

        return (
          findColumn(
            headers,
            [name]
          ) < 0
        );
      }
    );

  if (missing.length) {

    sheet
      .getRange(
        1,
        headers.length + 1,
        1,
        missing.length
      )
      .setValues([
        missing
      ]);

    headers =
      headers.concat(
        missing
      );
  }

  const map = {};

  requiredHeaders.forEach(
    function(name) {

      map[name] =
        findColumn(
          headers,
          [name]
        );
    }
  );

  map._headers = headers;

  return map;
}


function findColumn(
  headers,
  names
) {

  if (
    !Array.isArray(names)
  ) {

    names = [
      names
    ];
  }

  const normalized =
    headers.map(
      function(header) {

        return String(
          header
        )
          .trim()
          .toLowerCase();
      }
    );

  for (
    let i = 0;
    i < names.length;
    i++
  ) {

    const wanted =
      String(
        names[i]
      )
        .trim()
        .toLowerCase();

    const index =
      normalized.indexOf(
        wanted
      );

    if (
      index >= 0
    ) {

      return index;
    }
  }

  return -1;
}


function getAllRows(sheet) {

  const lastRow =
    sheet.getLastRow();

  const lastColumn =
    sheet.getLastColumn();

  if (
    lastRow < 2 ||
    lastColumn < 1
  ) {

    return {

      headers:
        getHeaders(
          sheet
        ),

      rows: []
    };
  }

  const values =
    sheet
      .getRange(
        1,
        1,
        lastRow,
        lastColumn
      )
      .getValues();

  return {

    headers:
      values[0].map(
        function(value) {

          return String(
            value || ""
          ).trim();
        }
      ),

    rows:
      values.slice(1)
  };
}


/* =========================================================
   PHONE NORMALIZATION
========================================================= */

function normalizePhone(phone) {

  if (
    phone === null ||
    phone === undefined
  ) {

    return "";
  }

  let value =
    String(
      phone
    ).trim();

  value =
    value.replace(
      /[^\d+]/g,
      ""
    );

  value =
    value.replace(
      /^\+/,
      ""
    );

  value =
    value.replace(
      /\.0$/,
      ""
    );

  /*
   * 00201275122774
   *
   * becomes
   *
   * 01275122774
   */
  if (
    value.startsWith(
      "0020"
    )
  ) {

    value =
      "0" +
      value.substring(4);

  } else if (
    value.startsWith(
      "002"
    )
  ) {

    value =
      "0" +
      value.substring(3);

  } else if (
    value.startsWith("20") &&
    value.length === 12
  ) {

    value =
      "0" +
      value.substring(2);
  }

  value =
    value.replace(
      /\D/g,
      ""
    );

  /*
   * Google Sheets may remove the leading zero.
   */
  if (
    value.length === 10 &&
    value.startsWith("1")
  ) {

    value =
      "0" +
      value;
  }

  if (
    value.length !== 11 ||
    !value.startsWith("01")
  ) {

    return "";
  }

  return value;
}


/* =========================================================
   PHONE COLUMN FORMAT
========================================================= */

function setPhoneColumnAsText(
  sheet
) {

  const headers =
    getHeaders(
      sheet
    );

  const phoneIndex =
    findColumn(
      headers,
      [
        "Phone",
        "Phone Number",
        "Mobile",
        "Mobile Number"
      ]
    );

  if (
    phoneIndex < 0
  ) {

    return;
  }

  const lastRow =
    sheet.getLastRow();

  if (
    lastRow < 2
  ) {

    return;
  }

  sheet
    .getRange(
      2,
      phoneIndex + 1,
      lastRow - 1,
      1
    )
    .setNumberFormat("@");
}


/* =========================================================
   USER ID
========================================================= */

function generateUserId(phone) {

  const normalized =
    normalizePhone(
      phone
    );

  if (!normalized) {

    return "";
  }

  const digest =
    Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_256,
      normalized,
      Utilities.Charset.UTF_8
    );

  const hex =
    digest
      .map(
        function(byte) {

          const unsigned =
            byte < 0
              ? byte + 256
              : byte;

          return unsigned
            .toString(16)
            .padStart(
              2,
              "0"
            );
        }
      )
      .join("")
      .substring(
        0,
        CONFIG.USER_ID_LENGTH
      )
      .toUpperCase();

  return (
    CONFIG.USER_ID_PREFIX +
    hex
  );
}


/* =========================================================
   SYSTEM SETUP
========================================================= */

/*
 * setupSystem() creates sheets/headers that, once they exist, never
 * need to be checked again. The old code re-verified everything
 * (15-20+ Sheets API calls) on EVERY request. We now check a single
 * fast script property first and skip straight out if setup already
 * ran. Bump SETUP_VERSION if you add new required columns later.
 */
var SETUP_VERSION = "v3";

function setupSystem() {

  const props =
    PropertiesService.getScriptProperties();

  if (
    props.getProperty("setupVersion") ===
    SETUP_VERSION
  ) {
    return;
  }

  const spreadsheet =
    getSpreadsheet();

  /*
   * Products
   */
  ensureSheetHeaders(
    spreadsheet,
    CONFIG.SHEETS.PRODUCTS,
    [
      "ID",
      "Product",
      "Category",
      "Price",
      "Emoji",
      "Active"
    ]
  );


  /*
   * Orders
   */
  ensureSheetHeaders(
    spreadsheet,
    CONFIG.SHEETS.ORDERS,
    [
      "Order ID",
      "Created At",
      "Name",
      "Phone",
      "Address",
      "Delivery Slot",
      "Delivery Type",
      "Delivery Date",
      "Total",
      "Status",
      "Update"
    ]
  );


  /*
   * OrderItems
   *
   * STATUS IS IMPORTANT.
   */
  ensureSheetHeaders(
    spreadsheet,
    CONFIG.SHEETS.ORDER_ITEMS,
    [
      "Order ID",
      "Product ID",
      "Product",
      "Price",
      "Quantity",
      "Total",
      "Status"
    ]
  );


  /*
   * Customers
   */
  ensureSheetHeaders(
    spreadsheet,
    CONFIG.SHEETS.CUSTOMERS,
    [
      "Name",
      "Phone",
      "Address",
      "Updated At"
    ]
  );


  /*
   * User IDs
   */
  ensureHeader(
    getSheet(
      CONFIG.SHEETS.ORDERS
    ),
    "User ID"
  );


  ensureHeader(
    getSheet(
      CONFIG.SHEETS.CUSTOMERS
    ),
    "User ID"
  );


  /*
   * Phone columns.
   */
  setPhoneColumnAsText(
    getSheet(
      CONFIG.SHEETS.ORDERS
    )
  );


  setPhoneColumnAsText(
    getSheet(
      CONFIG.SHEETS.CUSTOMERS
    )
  );


  /*
   * Automatic status synchronization is handled by the
   * bound spreadsheet onEdit(e) function below.
   *
   * No manual trigger installation is required.
   */


  SpreadsheetApp.flush();

  props.setProperty(
    "setupVersion",
    SETUP_VERSION
  );
}


/* =========================================================
   ENSURE SHEET HEADERS
========================================================= */

function ensureSheetHeaders(
  spreadsheet,
  sheetName,
  requiredHeaders
) {

  let sheet =
    spreadsheet.getSheetByName(
      sheetName
    );

  if (!sheet) {

    sheet =
      spreadsheet.insertSheet(
        sheetName
      );
  }

  if (
    sheet.getLastRow() === 0
  ) {

    sheet
      .getRange(
        1,
        1,
        1,
        requiredHeaders.length
      )
      .setValues([
        requiredHeaders
      ]);

    sheet.setFrozenRows(
      1
    );

    return;
  }

  requiredHeaders.forEach(
    function(header) {

      ensureHeader(
        sheet,
        header
      );
    }
  );

  sheet.setFrozenRows(
    1
  );
}


/* =========================================================
   AUTOMATIC ORDER STATUS TRIGGER
========================================================= */

/*
 * IMPORTANT:
 *
 * This project is bound to the Google Sheet.
 *
 * We use the native/simple onEdit(e) trigger for manual
 * changes made directly in the Orders sheet.
 *
 * The handler uses e.range.getSheet() and NEVER calls
 * SpreadsheetApp.openById(), which makes it reliable when
 * the trigger runs without an authorized web-app context.
 *
 * It works for ANY status:
 *
 * Active -> Completed
 * Active -> Cancelled
 * Active -> Delivered
 * Active -> Pending
 * etc.
 *
 * Every matching OrderItems row gets the exact same status.
 *
 * If the status is anything other than Active, the matching
 * OrderItems are then deleted.
 */

function onEdit(e) {

  try {

    if (
      !e ||
      !e.range
    ) {
      return;
    }

    const range = e.range;
    const sheet = range.getSheet();

    /*
     * Only the Orders sheet.
     */
    if (
      sheet.getName() !==
      CONFIG.SHEETS.ORDERS
    ) {
      return;
    }

    /*
     * Ignore header row.
     */
    if (
      range.getRow() < 2
    ) {
      return;
    }

    const headers =
      getHeaders(sheet);

    const statusIndex =
      findColumn(
        headers,
        ["Status"]
      );

    const orderIdIndex =
      findColumn(
        headers,
        [
          "Order ID",
          "OrderId"
        ]
      );

    if (
      statusIndex < 0 ||
      orderIdIndex < 0
    ) {
      return;
    }

    /*
     * Only react when the edit intersects the Status column.
     *
     * This also handles a paste/edit across multiple columns.
     */
    const firstColumn =
      range.getColumn();

    const lastColumn =
      firstColumn +
      range.getNumColumns() -
      1;

    const statusColumn =
      statusIndex + 1;

    if (
      statusColumn < firstColumn ||
      statusColumn > lastColumn
    ) {
      return;
    }

    /*
     * Handle every edited row. This is important when the user
     * pastes several order statuses at once.
     */
    const firstRow =
      range.getRow();

    const lastRow =
      firstRow +
      range.getNumRows() -
      1;

    for (
      let rowNumber = firstRow;
      rowNumber <= lastRow;
      rowNumber++
    ) {

      if (
        rowNumber < 2
      ) {
        continue;
      }

      const orderId =
        cleanValue(
          sheet
            .getRange(
              rowNumber,
              orderIdIndex + 1
            )
            .getDisplayValue()
        );

      const newStatus =
        cleanValue(
          sheet
            .getRange(
              rowNumber,
              statusColumn
            )
            .getDisplayValue()
        );

      if (
        !orderId ||
        !newStatus
      ) {
        continue;
      }

      /*
       * Use the spreadsheet directly from the edit event.
       * This avoids openById() inside the simple trigger.
       */
      updateOrderItemsStatusFromSheet_(
        sheet,
        orderId,
        newStatus
      );
    }

    /*
     * Remove every OrderItem whose status is not Active.
     */
    cleanupInactiveOrderItemsFromSheet_(
      sheet.getParent()
    );

    SpreadsheetApp.flush();

  } catch (error) {

    console.error(
      "ORDER STATUS onEdit ERROR: " +
      error.stack
    );

    Logger.log(
      "ORDER STATUS onEdit ERROR: " +
      error.stack
    );
  }
}


/*
 * Kept for compatibility with any installable trigger that
 * may already exist in the Apps Script project.
 *
 * If an old installable trigger is still present, it will use
 * the same reliable direct-sheet handler.
 */
function orderStatusChangeTrigger(e) {

  onEdit(e);
}


/*
 * IMPORTANT:
 *
 * This function is intentionally NOT called from setupSystem().
 *
 * The native onEdit(e) trigger above is sufficient and avoids
 * duplicate executions.
 *
 * If an old installable trigger exists, it is harmless because
 * orderStatusChangeTrigger() uses the same safe handler.
 */
function installOrderStatusTrigger() {

  /*
   * Always bind the installable trigger to the SAME spreadsheet
   * used by the backend. Do not depend on the currently active
   * spreadsheet, because this function may be run from the Apps
   * Script editor or after a web-app deployment.
   */
  const spreadsheet =
    getSpreadsheet();

  const triggers =
    ScriptApp.getProjectTriggers();

  /*
   * Remove duplicate/old installable triggers for this handler.
   * This prevents multiple executions and makes re-running
   * initializeSystem() safe.
   */
  triggers.forEach(
    function(trigger) {

      const handler =
        trigger.getHandlerFunction();

      if (
        handler ===
        "orderStatusChangeTrigger"
      ) {

        ScriptApp.deleteTrigger(
          trigger
        );
      }
    }
  );

  /*
   * Create exactly ONE installable onEdit trigger.
   * This trigger has authorization to update/delete rows in
   * OrderItems, unlike relying only on a simple onEdit trigger.
   */
  ScriptApp
    .newTrigger(
      "orderStatusChangeTrigger"
    )
    .forSpreadsheet(
      spreadsheet.getId()
    )
    .onEdit()
    .create();

  Logger.log(
    "Order status trigger installed for spreadsheet: " +
    spreadsheet.getId()
  );
}


/* =========================================================
   DIRECT SHEET STATUS SYNCHRONIZATION
========================================================= */

/*
 * This version receives the actual OrderItems sheet through
 * the spreadsheet that belongs to the edit event.
 *
 * It does NOT call getSpreadsheet()/openById().
 */
function updateOrderItemsStatusFromSheet_(
  ordersSheet,
  orderId,
  newStatus
) {

  orderId =
    cleanValue(orderId);

  newStatus =
    cleanValue(newStatus);

  if (
    !orderId ||
    !newStatus
  ) {
    return 0;
  }

  const spreadsheet =
    ordersSheet.getParent();

  const itemsSheet =
    spreadsheet.getSheetByName(
      CONFIG.SHEETS.ORDER_ITEMS
    );

  if (!itemsSheet) {
    return 0;
  }

  const statusIndex =
    ensureHeader(
      itemsSheet,
      "Status"
    );

  const headers =
    getHeaders(
      itemsSheet
    );

  const orderIdIndex =
    findColumn(
      headers,
      [
        "Order ID",
        "OrderId"
      ]
    );

  if (
    orderIdIndex < 0
  ) {
    return 0;
  }

  const lastRow =
    itemsSheet.getLastRow();

  if (
    lastRow < 2
  ) {
    return 0;
  }

  const lastColumn =
    itemsSheet.getLastColumn();

  const values =
    itemsSheet
      .getRange(
        2,
        1,
        lastRow - 1,
        lastColumn
      )
      .getValues();

  let updated = 0;

  /*
   * Update all matching rows in memory first.
   */
  const statusValues =
    itemsSheet
      .getRange(
        2,
        statusIndex + 1,
        lastRow - 1,
        1
      )
      .getValues();

  for (
    let i = 0;
    i < values.length;
    i++
  ) {

    const rowOrderId =
      cleanValue(
        values[i][orderIdIndex]
      );

    if (
      rowOrderId === orderId
    ) {

      statusValues[i][0] =
        newStatus;

      updated++;
    }
  }

  if (
    updated > 0
  ) {

    itemsSheet
      .getRange(
        2,
        statusIndex + 1,
        statusValues.length,
        1
      )
      .setValues(
        statusValues
      );
  }

  SpreadsheetApp.flush();

  Logger.log(
    "OrderItems status updated: " +
    orderId +
    " -> " +
    newStatus +
    " (" +
    updated +
    " rows)"
  );

  return updated;
}


/*
 * Cleanup helper specifically for the edit trigger.
 *
 * It uses the same spreadsheet that generated e.range.
 */
function cleanupInactiveOrderItemsFromSheet_(
  spreadsheet
) {

  const itemsSheet =
    spreadsheet.getSheetByName(
      CONFIG.SHEETS.ORDER_ITEMS
    );

  if (!itemsSheet) {
    return 0;
  }

  const statusIndex =
    ensureHeader(
      itemsSheet,
      "Status"
    );

  const lastRow =
    itemsSheet.getLastRow();

  if (
    lastRow < 2
  ) {
    return 0;
  }

  const lastColumn =
    itemsSheet.getLastColumn();

  const values =
    itemsSheet
      .getRange(
        2,
        1,
        lastRow - 1,
        lastColumn
      )
      .getValues();

  const rowsToDelete = [];

  for (
    let i = 0;
    i < values.length;
    i++
  ) {

    const status =
      cleanValue(
        values[i][statusIndex]
      );

    if (
      status.toLowerCase() !==
      CONFIG.ACTIVE_STATUS.toLowerCase()
    ) {

      rowsToDelete.push(
        i + 2
      );
    }
  }

  /*
   * Delete bottom-to-top so row numbers remain valid.
   */
  for (
    let i =
      rowsToDelete.length - 1;
    i >= 0;
    i--
  ) {

    itemsSheet.deleteRow(
      rowsToDelete[i]
    );
  }

  SpreadsheetApp.flush();

  Logger.log(
    "OrderItems cleanup deleted: " +
    rowsToDelete.length
  );

  return rowsToDelete.length;
}


/* =========================================================
   UPDATE ALL ORDER ITEMS FOR AN ORDER
========================================================= */

function updateOrderItemsStatus(
  orderId,
  newStatus
) {

  orderId =
    cleanValue(
      orderId
    );

  newStatus =
    cleanValue(
      newStatus
    );

  if (
    !orderId ||
    !newStatus
  ) {

    return 0;
  }


  const sheet =
    getSheet(
      CONFIG.SHEETS.ORDER_ITEMS
    );


  /*
   * Make sure Status exists.
   */
  const statusIndex =
    ensureHeader(
      sheet,
      "Status"
    );


  const headers =
    getHeaders(
      sheet
    );


  const orderIdIndex =
    findColumn(
      headers,
      [
        "Order ID",
        "OrderId"
      ]
    );


  if (
    orderIdIndex < 0
  ) {

    throw new Error(
      'OrderItems sheet must contain "Order ID".'
    );
  }


  const lastRow =
    sheet.getLastRow();


  if (
    lastRow < 2
  ) {

    return 0;
  }


  const values =
    sheet
      .getRange(
        2,
        1,
        lastRow - 1,
        sheet.getLastColumn()
      )
      .getValues();


  let updated =
    0;


  for (
    let i = 0;
    i < values.length;
    i++
  ) {

    const rowOrderId =
      cleanValue(
        values[i][orderIdIndex]
      );


    if (
      rowOrderId ===
      orderId
    ) {

      sheet
        .getRange(
          i + 2,
          statusIndex + 1
        )
        .setValue(
          newStatus
        );

      updated++;
    }
  }


  SpreadsheetApp.flush();


  Logger.log(
    "OrderItems status updated: " +
    orderId +
    " -> " +
    newStatus +
    " (" +
    updated +
    " rows)"
  );


  return updated;
}


/* =========================================================
   DELETE ORDER ITEMS FOR ONE ORDER
========================================================= */

/*
 * Used by app-side cancellation.
 *
 * This intentionally deletes only the OrderItems belonging to
 * the order being cancelled. It does not depend on the
 * installable onEdit trigger and does not scan/delete items
 * belonging to other orders.
 */
function deleteOrderItemsForOrder(
  orderId
) {

  orderId =
    cleanValue(
      orderId
    );

  if (!orderId) {
    return 0;
  }

  const sheet =
    getSheet(
      CONFIG.SHEETS.ORDER_ITEMS
    );

  const headers =
    getHeaders(
      sheet
    );

  const orderIdIndex =
    findColumn(
      headers,
      [
        "Order ID",
        "OrderId"
      ]
    );

  if (
    orderIdIndex < 0
  ) {
    return 0;
  }

  const lastRow =
    sheet.getLastRow();

  if (
    lastRow < 2
  ) {
    return 0;
  }

  const lastColumn =
    sheet.getLastColumn();

  const values =
    sheet
      .getRange(
        2,
        1,
        lastRow - 1,
        lastColumn
      )
      .getValues();

  const rowsToDelete =
    [];

  for (
    let i = 0;
    i < values.length;
    i++
  ) {

    const rowOrderId =
      cleanValue(
        values[i][orderIdIndex]
      );

    if (
      rowOrderId ===
      orderId
    ) {

      rowsToDelete.push(
        i + 2
      );
    }
  }

  /*
   * Delete bottom-to-top so row numbers remain valid.
   */
  for (
    let i =
      rowsToDelete.length - 1;
    i >= 0;
    i--
  ) {

    sheet.deleteRow(
      rowsToDelete[i]
    );
  }

  SpreadsheetApp.flush();

  Logger.log(
    "OrderItems deleted for order " +
    orderId +
    ": " +
    rowsToDelete.length
  );

  return rowsToDelete.length;
}


/* =========================================================
   SYNCHRONIZE EXISTING ORDERITEMS
========================================================= */

function synchronizeAllOrderItemStatuses() {

  const ordersSheet =
    getSheet(
      CONFIG.SHEETS.ORDERS
    );

  const itemsSheet =
    getSheet(
      CONFIG.SHEETS.ORDER_ITEMS
    );


  const ordersData =
    getAllRows(
      ordersSheet
    );

  const itemsData =
    getAllRows(
      itemsSheet
    );


  if (
    itemsData.rows.length === 0
  ) {

    return {

      ok: true,

      updated: 0
    };
  }


  const orderIdIndex =
    findColumn(
      ordersData.headers,
      [
        "Order ID",
        "OrderId"
      ]
    );


  const orderStatusIndex =
    findColumn(
      ordersData.headers,
      [
        "Status"
      ]
    );


  const itemOrderIdIndex =
    findColumn(
      itemsData.headers,
      [
        "Order ID",
        "OrderId"
      ]
    );


  const itemStatusIndex =
    ensureHeader(
      itemsSheet,
      "Status"
    );


  if (
    orderIdIndex < 0 ||
    orderStatusIndex < 0 ||
    itemOrderIdIndex < 0
  ) {

    throw new Error(
      "Missing Order ID or Status column."
    );
  }


  const orderStatusMap =
    {};


  for (
    let i = 0;
    i < ordersData.rows.length;
    i++
  ) {

    const row =
      ordersData.rows[i];

    const orderId =
      cleanValue(
        row[orderIdIndex]
      );

    const status =
      cleanValue(
        row[orderStatusIndex]
      );

    if (
      orderId
    ) {

      orderStatusMap[
        orderId
      ] =
        status;
    }
  }


  let updated =
    0;


  for (
    let i = 0;
    i < itemsData.rows.length;
    i++
  ) {

    const row =
      itemsData.rows[i];

    const orderId =
      cleanValue(
        row[itemOrderIdIndex]
      );


    let status =
      "Orphaned";


    if (
      orderId &&
      Object.prototype.hasOwnProperty.call(
        orderStatusMap,
        orderId
      )
    ) {

      status =
        orderStatusMap[
          orderId
        ];
    }


    itemsSheet
      .getRange(
        i + 2,
        itemStatusIndex + 1
      )
      .setValue(
        status
      );


    updated++;
  }


  SpreadsheetApp.flush();


  return {

    ok: true,

    updated:
      updated
  };
}


/* =========================================================
   CLEANUP NON-ACTIVE ORDER ITEMS
========================================================= */

/*
 * IMPORTANT:
 *
 * This function now uses OrderItems.Status ONLY.
 *
 * It does NOT determine status from Orders.
 *
 * ONLY:
 *
 *     Active
 *
 * remains.
 *
 * Everything else is deleted.
 */

function cleanupInactiveOrderItems() {

  const sheet =
    getSheet(
      CONFIG.SHEETS.ORDER_ITEMS
    );


  const statusIndex =
    ensureHeader(
      sheet,
      "Status"
    );


  const lastRow =
    sheet.getLastRow();


  if (
    lastRow < 2
  ) {

    return {

      ok: true,

      deleted: 0
    };
  }


  const values =
    sheet
      .getRange(
        2,
        1,
        lastRow - 1,
        sheet.getLastColumn()
      )
      .getValues();


  const rowsToDelete =
    [];


  for (
    let i = 0;
    i < values.length;
    i++
  ) {

    const status =
      cleanValue(
        values[i][statusIndex]
      );


    if (
      status.toLowerCase() !==
      CONFIG.ACTIVE_STATUS.toLowerCase()
    ) {

      rowsToDelete.push(
        i + 2
      );
    }
  }


  /*
   * Bottom to top.
   */
  for (
    let i =
      rowsToDelete.length - 1;
    i >= 0;
    i--
  ) {

    sheet.deleteRow(
      rowsToDelete[i]
    );
  }


  SpreadsheetApp.flush();


  Logger.log(
    "OrderItems cleanup deleted: " +
    rowsToDelete.length
  );


  return {

    ok: true,

    deleted:
      rowsToDelete.length
  };
}


/* =========================================================
   PRODUCTS
========================================================= */

/*
 * Products change rarely (edited by hand in the sheet), so we share
 * one 5-minute CacheService cache between the "products" endpoint
 * and createOrder's price lookup - avoids a full Products-sheet
 * read on every single order placed.
 */
function getProductsCached() {

  const cache =
    CacheService.getScriptCache();

  const cached =
    cache.get("products_v1");

  if (cached) {

    return JSON.parse(
      cached
    );
  }

  const result =
    getProducts();

  cache.put(
    "products_v1",
    JSON.stringify(result),
    300
  );

  return result;
}


function getProducts() {

  const sheet =
    getSheet(
      CONFIG.SHEETS.PRODUCTS
    );


  const data =
    getAllRows(
      sheet
    );


  const headers =
    data.headers;


  const idIndex =
    findColumn(
      headers,
      [
        "ID",
        "Product ID",
        "Id"
      ]
    );


  const nameIndex =
    findColumn(
      headers,
      [
        "Product",
        "Name",
        "Product Name"
      ]
    );


  const categoryIndex =
    findColumn(
      headers,
      [
        "Category"
      ]
    );


  const priceIndex =
    findColumn(
      headers,
      [
        "Price"
      ]
    );


  const emojiIndex =
    findColumn(
      headers,
      [
        "Emoji",
        "Icon"
      ]
    );


  const activeIndex =
    findColumn(
      headers,
      [
        "Active",
        "Is Active"
      ]
    );


  const products =
    data.rows
      .map(
        function(row) {

          return {

            id:
              idIndex >= 0
                ? row[idIndex]
                : "",

            name:
              nameIndex >= 0
                ? cleanValue(
                    row[nameIndex]
                  )
                : "",

            category:
              categoryIndex >= 0
                ? cleanValue(
                    row[categoryIndex]
                  )
                : "Bakery",

            price:
              priceIndex >= 0
                ? parseNumber(
                    row[priceIndex]
                  )
                : 0,

            emoji:
              emojiIndex >= 0
                ? cleanValue(
                    row[emojiIndex]
                  ) || "🥖"
                : "🥖",

            active:
              activeIndex >= 0
                ? isActiveValue(
                    row[activeIndex]
                  )
                : true
          };
        }
      )
      .filter(
        function(product) {

          return (
            product.name &&
            product.active
          );
        }
      );


  return {

    ok: true,

    products:
      products,

    deliveryFee:
      CONFIG.DELIVERY_FEE,

    sameDayCutoffHour:
      CONFIG.SAME_DAY_CUTOFF_HOUR,

    nextDayCancelCutoffHour:
      CONFIG.NEXT_DAY_CANCEL_CUTOFF_HOUR,

    nextDayCancelCutoffMinute:
      CONFIG.NEXT_DAY_CANCEL_CUTOFF_MINUTE
  };
}


function isActiveValue(value) {

  if (
    typeof value ===
    "boolean"
  ) {

    return value;
  }


  const text =
    String(
      value ?? ""
    )
      .trim()
      .toLowerCase();


  return !(
    text === "false" ||
    text === "no" ||
    text === "0" ||
    text === "inactive"
  );
}


/* =========================================================
   CUSTOMER
========================================================= */

function upsertCustomer(
  userId,
  customer
) {

  const sheet =
    getSheet(
      CONFIG.SHEETS.CUSTOMERS
    );

  const idx =
    getHeaderIndexes(
      sheet,
      [
        "Name",
        "Phone",
        "Address",
        "Updated At",
        "User ID"
      ]
    );

  const nameIndex = idx["Name"];
  const phoneIndex = idx["Phone"];
  const addressIndex = idx["Address"];
  const updatedIndex = idx["Updated At"];
  const userIdIndex = idx["User ID"];


  const phone =
    normalizePhone(
      customer.phone
    );


  if (
    !phone ||
    !userId
  ) {

    throw new Error(
      "Invalid customer phone/User ID."
    );
  }


  const data =
    getAllRows(
      sheet
    );


  let existingRow =
    -1;


  /*
   * First search by User ID.
   */
  for (
    let i = 0;
    i < data.rows.length;
    i++
  ) {

    if (
      cleanValue(
        data.rows[i][userIdIndex]
      ) ===
      userId
    ) {

      existingRow =
        i + 2;

      break;
    }
  }


  /*
   * Then fallback to normalized phone.
   */
  if (
    existingRow === -1
  ) {

    for (
      let i = 0;
      i < data.rows.length;
      i++
    ) {

      if (
        normalizePhone(
          data.rows[i][phoneIndex]
        ) ===
        phone
      ) {

        existingRow =
          i + 2;

        break;
      }
    }
  }


  const now =
    new Date();


  const columnCount =
    data.headers.length;


  if (
    existingRow !== -1
  ) {

    /*
     * One batched write for the whole row instead of 5
     * separate .getRange().setValue() round trips.
     */
    const updatedRow =
      data.rows[existingRow - 2]
        .slice();

    while (
      updatedRow.length <
      columnCount
    ) {
      updatedRow.push("");
    }

    updatedRow[nameIndex] =
      customer.name || "";

    updatedRow[phoneIndex] =
      phone;

    updatedRow[addressIndex] =
      customer.address || "";

    updatedRow[updatedIndex] =
      now;

    updatedRow[userIdIndex] =
      userId;

    sheet
      .getRange(
        existingRow,
        phoneIndex + 1
      )
      .setNumberFormat("@");

    sheet
      .getRange(
        existingRow,
        1,
        1,
        columnCount
      )
      .setValues([
        updatedRow
      ]);

    SpreadsheetApp.flush();

    return;
  }


  const headers =
    data.headers;


  const row =
    new Array(
      headers.length
    ).fill("");


  row[nameIndex] =
    customer.name ||
    "";


  row[phoneIndex] =
    phone;


  row[addressIndex] =
    customer.address ||
    "";


  row[updatedIndex] =
    now;


  row[userIdIndex] =
    userId;


  sheet
    .getRange(
      sheet.getLastRow() + 1,
      1,
      1,
      headers.length
    )
    .setValues([
      row
    ]);


  sheet
    .getRange(
      sheet.getLastRow(),
      phoneIndex + 1
    )
    .setNumberFormat("@");


  SpreadsheetApp.flush();
}


/* =========================================================
   CREATE ORDER
========================================================= */

function createOrder(
  payload
) {

  if (!payload) {

    throw new Error(
      "Order data is missing."
    );
  }


  const customer =
    payload.customer ||
    {};


  const name =
    cleanValue(
      customer.name ||
      payload.name ||
      ""
    );


  const phone =
    normalizePhone(
      customer.phone ||
      payload.phone ||
      payload.phoneNumber ||
      ""
    );


  const address =
    cleanValue(
      customer.address ||
      payload.address ||
      ""
    );


  const slot =
    cleanValue(
      payload.deliverySlot ||
      payload.slot ||
      ""
    );


  const deliveryType =
    cleanValue(
      payload.deliveryType ||
      ""
    ).toLowerCase() ===
    "same day" ||
    cleanValue(
      payload.deliveryType ||
      ""
    ).toLowerCase() ===
    "same_day" ||
    payload.sameDay === true
      ? CONFIG.DELIVERY_TYPES.SAME_DAY
      : CONFIG.DELIVERY_TYPES.NEXT_DAY;


  const items =
    Array.isArray(
      payload.items
    )
      ? payload.items
      : [];


  if (!name) {

    throw new Error(
      "Customer name is required."
    );
  }


  if (!phone) {

    throw new Error(
      "Customer phone number is invalid."
    );
  }


  if (!address) {

    throw new Error(
      "Customer address is required."
    );
  }


  if (!slot) {

    throw new Error(
      "Delivery slot is required."
    );
  }


  if (!items.length) {

    throw new Error(
      "Order must contain at least one item."
    );
  }


  /*
   * Enforce the same-day cutoff on the server, independent of the
   * customer's device clock - defense in depth against the UI
   * option being stale or bypassed.
   */
  if (
    deliveryType ===
    CONFIG.DELIVERY_TYPES.SAME_DAY &&
    getCurrentHour() >=
    CONFIG.SAME_DAY_CUTOFF_HOUR
  ) {

    throw new Error(
      "Same-day delivery orders must be placed before 5:00 PM."
    );
  }


  const userId =
    generateUserId(
      phone
    );


  upsertCustomer(
    userId,
    {
      name:
        name,

      phone:
        phone,

      address:
        address
    }
  );


  const productsResponse =
    getProductsCached();


  const products =
    productsResponse.products ||
    [];


  const productMap =
    {};


  products.forEach(
    function(product) {

      productMap[
        String(
          product.id
        )
      ] =
        product;


      productMap[
        String(
          product.name
        )
          .trim()
          .toLowerCase()
      ] =
        product;
    }
  );


  let orderTotal =
    0;


  const finalItems =
    [];


  items.forEach(
    function(item) {

      const productId =
        cleanValue(
          item.productId ||
          item.id ||
          ""
        );


      const productName =
        cleanValue(
          item.product ||
          item.name ||
          ""
        );


      const quantity =
        Math.max(
          1,
          parseNumber(
            item.quantity ??
            item.qty ??
            1
          )
        );


      let product =
        productMap[
          productId
        ];


      if (
        !product &&
        productName
      ) {

        product =
          productMap[
            productName
              .toLowerCase()
          ];
      }


      if (!product) {

        throw new Error(
          "Product not found: " +
          (
            productId ||
            productName
          )
        );
      }


      const price =
        parseNumber(
          product.price
        );


      const total =
        price *
        quantity;


      orderTotal +=
        total;


      finalItems.push({

        productId:
          product.id,

        product:
          product.name,

        price:
          price,

        quantity:
          quantity,

        total:
          total
      });
    }
  );


  const itemsTotal =
    orderTotal;


  /*
   * Fixed delivery fee, added once per order.
   */
  orderTotal +=
    CONFIG.DELIVERY_FEE;


  const lock =
    LockService
      .getScriptLock();


  lock.waitLock(
    10000
  );


  try {

    const ordersSheet =
      getSheet(
        CONFIG.SHEETS.ORDERS
      );


    const orderId =
      generateOrderId();


    const idx =
      getHeaderIndexes(
        ordersSheet,
        [
          "Order ID",
          "Created At",
          "Name",
          "Phone",
          "Address",
          "Delivery Slot",
          "Delivery Type",
          "Delivery Date",
          "Total",
          "Status",
          "Update",
          "User ID"
        ]
      );

    const orderIdIndex = idx["Order ID"];
    const createdIndex = idx["Created At"];
    const nameIndex = idx["Name"];
    const phoneIndex = idx["Phone"];
    const addressIndex = idx["Address"];
    const slotIndex = idx["Delivery Slot"];
    const deliveryTypeIndex = idx["Delivery Type"];
    const deliveryDateIndex = idx["Delivery Date"];
    const totalIndex = idx["Total"];
    const statusIndex = idx["Status"];
    const updateIndex = idx["Update"];
    const userIdIndex = idx["User ID"];


    const headers =
      idx._headers;


    const row =
      new Array(
        headers.length
      ).fill("");


    const now =
      new Date();


    row[orderIdIndex] =
      orderId;


    row[createdIndex] =
      now;


    row[nameIndex] =
      name;


    row[phoneIndex] =
      phone;


    row[addressIndex] =
      address;


    row[slotIndex] =
      slot;


    row[deliveryTypeIndex] =
      deliveryType;


    const deliveryTargetDate =
      computeDeliveryTargetDate(
        now,
        deliveryType
      );

    const deliveryDateLabel =
      formatDateLabel(
        deliveryTargetDate
      );

    row[deliveryDateIndex] =
      deliveryDateLabel;


    row[totalIndex] =
      orderTotal;


    row[statusIndex] =
      CONFIG.ACTIVE_STATUS;


    row[updateIndex] =
      now;


    row[userIdIndex] =
      userId;


    ordersSheet
      .getRange(
        ordersSheet.getLastRow() + 1,
        1,
        1,
        headers.length
      )
      .setValues([
        row
      ]);


    ordersSheet
      .getRange(
        ordersSheet.getLastRow(),
        phoneIndex + 1
      )
      .setNumberFormat("@");


    /*
     * IMPORTANT:
     *
     * New OrderItems are explicitly Active.
     */
    saveOrderItems(
      orderId,
      finalItems,
      CONFIG.ACTIVE_STATUS
    );


    SpreadsheetApp.flush();


    return {

      ok: true,

      orderId:
        orderId,

      userId:
        userId,

      phone:
        phone,

      itemsTotal:
        itemsTotal,

      deliveryFee:
        CONFIG.DELIVERY_FEE,

      deliveryType:
        deliveryType,

      deliveryDateLabel:
        deliveryDateLabel,

      deliverySlot:
        slot,

      total:
        orderTotal,

      status:
        CONFIG.ACTIVE_STATUS
    };


  } finally {

    lock.releaseLock();
  }
}


/* =========================================================
   ORDER ID
========================================================= */

/*
 * Current hour (0-23) in the script's timezone. Used to enforce the
 * same-day ordering/cancellation cutoff on the server, independent
 * of the customer's device clock.
 */
function getCurrentHour() {

  const timezone =
    Session.getScriptTimeZone() ||
    CONFIG.TIMEZONE;

  return Number(
    Utilities.formatDate(
      new Date(),
      timezone,
      "H"
    )
  );
}


function getCurrentMinute() {

  const timezone =
    Session.getScriptTimeZone() ||
    CONFIG.TIMEZONE;

  return Number(
    Utilities.formatDate(
      new Date(),
      timezone,
      "m"
    )
  );
}


/*
 * yyyy-MM-dd in the script's timezone - a comparable, DST-safe
 * "calendar day" key. Two Date objects are "the same day" if this
 * key matches, regardless of the time portion.
 */
function formatDateKey(
  date
) {

  const timezone =
    Session.getScriptTimeZone() ||
    CONFIG.TIMEZONE;

  return Utilities.formatDate(
    date,
    timezone,
    "yyyy-MM-dd"
  );
}


/*
 * Human-friendly date for display, e.g. "Wed, Aug 19".
 */
function formatDateLabel(
  date
) {

  const timezone =
    Session.getScriptTimeZone() ||
    CONFIG.TIMEZONE;

  return Utilities.formatDate(
    date,
    timezone,
    "EEE, MMM d"
  );
}


function addDays(
  date,
  days
) {

  const result =
    new Date(
      date.getTime()
    );

  result.setDate(
    result.getDate() +
    days
  );

  return result;
}


/*
 * The calendar date this order is actually meant to be delivered
 * on: the placement date itself for Same Day orders, or the day
 * after for Next Day orders.
 */
function computeDeliveryTargetDate(
  createdAt,
  deliveryType
) {

  return (
    deliveryType ===
    CONFIG.DELIVERY_TYPES.SAME_DAY
  )
    ? createdAt
    : addDays(
        createdAt,
        1
      );
}


function generateOrderId() {

  const now =
    new Date();


  const timezone =
    Session.getScriptTimeZone() ||
    CONFIG.TIMEZONE;


  const datePart =
    Utilities.formatDate(
      now,
      timezone,
      "yyyyMMdd"
    );


  const timePart =
    Utilities.formatDate(
      now,
      timezone,
      "HHmmss"
    );


  const randomPart =
    Math.floor(
      Math.random() *
      1000
    )
      .toString()
      .padStart(
        3,
        "0"
      );


  return (
    "MB-" +
    datePart +
    "-" +
    timePart +
    "-" +
    randomPart
  );
}


/* =========================================================
   SAVE ORDER ITEMS
========================================================= */

function saveOrderItems(
  orderId,
  items,
  status
) {

  const sheet =
    getSheet(
      CONFIG.SHEETS.ORDER_ITEMS
    );


  const idx =
    getHeaderIndexes(
      sheet,
      [
        "Order ID",
        "Product ID",
        "Product",
        "Price",
        "Quantity",
        "Total",
        "Status"
      ]
    );

  const orderIdIndex = idx["Order ID"];
  const productIdIndex = idx["Product ID"];
  const productIndex = idx["Product"];
  const priceIndex = idx["Price"];
  const quantityIndex = idx["Quantity"];
  const totalIndex = idx["Total"];
  const statusIndex = idx["Status"];


  const headers =
    idx._headers;


  const itemStatus =
    cleanValue(
      status ||
      CONFIG.ACTIVE_STATUS
    );


  const rows =
    items.map(
      function(item) {

        const row =
          new Array(
            headers.length
          ).fill("");


        row[orderIdIndex] =
          orderId;


        row[productIdIndex] =
          item.productId ||
          "";


        row[productIndex] =
          item.product ||
          "";


        row[priceIndex] =
          parseNumber(
            item.price
          );


        row[quantityIndex] =
          parseNumber(
            item.quantity
          ) || 1;


        row[totalIndex] =
          parseNumber(
            item.total
          );


        /*
         * EVERY NEW ITEM STARTS AS ACTIVE.
         */
        row[statusIndex] =
          itemStatus;


        return row;
      }
    );


  if (
    rows.length
  ) {

    sheet
      .getRange(
        sheet.getLastRow() + 1,
        1,
        rows.length,
        headers.length
      )
      .setValues(
        rows
      );
  }


  SpreadsheetApp.flush();
}


/* =========================================================
   GET ORDERS BY USER ID
========================================================= */

function getOrdersByUserId(
  userId
) {

  userId =
    cleanValue(
      userId
    );


  if (!userId) {

    return [];
  }


  const sheet =
    getSheet(
      CONFIG.SHEETS.ORDERS
    );


  const data =
    getAllRows(
      sheet
    );


  if (
    data.rows.length === 0
  ) {

    return [];
  }


  const headers =
    data.headers;


  const orderIdIndex =
    findColumn(
      headers,
      [
        "Order ID",
        "OrderId",
        "ID"
      ]
    );


  const createdIndex =
    findColumn(
      headers,
      [
        "Created At",
        "CreatedAt",
        "Date"
      ]
    );


  const nameIndex =
    findColumn(
      headers,
      [
        "Name",
        "Customer Name"
      ]
    );


  const phoneIndex =
    findColumn(
      headers,
      [
        "Phone",
        "Phone Number",
        "Mobile"
      ]
    );


  const addressIndex =
    findColumn(
      headers,
      [
        "Address"
      ]
    );


  const slotIndex =
    findColumn(
      headers,
      [
        "Delivery Slot",
        "DeliverySlot",
        "Slot"
      ]
    );


  const deliveryTypeIndex =
    findColumn(
      headers,
      [
        "Delivery Type",
        "DeliveryType"
      ]
    );


  const totalIndex =
    findColumn(
      headers,
      [
        "Total",
        "Amount"
      ]
    );


  const statusIndex =
    findColumn(
      headers,
      [
        "Status"
      ]
    );


  const userIdIndex =
    findColumn(
      headers,
      [
        "User ID",
        "UserID"
      ]
    );


  if (
    userIdIndex < 0
  ) {

    return [];
  }


  const itemMap =
    getOrderItemsMap();


  const orders =
    [];


  for (
    let i = 0;
    i < data.rows.length;
    i++
  ) {

    const row =
      data.rows[i];


    const rowUserId =
      cleanValue(
        row[userIdIndex]
      );


    if (
      rowUserId !==
      userId
    ) {

      continue;
    }


    const status =
      statusIndex >= 0
        ? cleanValue(
            row[statusIndex]
          )
        : CONFIG.ACTIVE_STATUS;


    /*
     * Only Active Orders are returned.
     */
    if (
      status.toLowerCase() !==
      CONFIG.ACTIVE_STATUS.toLowerCase()
    ) {

      continue;
    }


    const orderId =
      orderIdIndex >= 0
        ? cleanValue(
            row[orderIdIndex]
          )
        : "";


    if (!orderId) {

      continue;
    }


    /*
     * Orders placed before this feature existed have no value
     * here - treat them as Next Day (their original behavior).
     */
    const rowDeliveryType =
      (
        deliveryTypeIndex >= 0 &&
        cleanValue(
          row[deliveryTypeIndex]
        )
      ) ||
      CONFIG.DELIVERY_TYPES.NEXT_DAY;


    /*
     * "Today" / "Tomorrow" and the date shown next to it are
     * computed live against the CURRENT date, not fixed at order
     * time - so an order placed yesterday for "tomorrow" correctly
     * flips to "Today" once that calendar day actually arrives.
     */
    let dayLabel =
      rowDeliveryType ===
      CONFIG.DELIVERY_TYPES.SAME_DAY
        ? "Today"
        : "Tomorrow";

    let deliveryDateLabel = "";

    if (
      createdIndex >= 0 &&
      Object.prototype.toString.call(
        row[createdIndex]
      ) ===
      "[object Date]"
    ) {

      const targetDate =
        computeDeliveryTargetDate(
          row[createdIndex],
          rowDeliveryType
        );

      const targetKey =
        formatDateKey(
          targetDate
        );

      const todayKey =
        formatDateKey(
          new Date()
        );

      dayLabel =
        targetKey <= todayKey
          ? "Today"
          : "Tomorrow";

      deliveryDateLabel =
        formatDateLabel(
          targetDate
        );
    }


    orders.push({

      orderId:
        orderId,

      userId:
        userId,

      createdAt:
        createdIndex >= 0
          ? serializeDate(
              row[createdIndex]
            )
          : "",

      name:
        nameIndex >= 0
          ? cleanValue(
              row[nameIndex]
            )
          : "",

      phone:
        phoneIndex >= 0
          ? normalizePhone(
              row[phoneIndex]
            )
          : "",

      address:
        addressIndex >= 0
          ? cleanValue(
              row[addressIndex]
            )
          : "",

      deliverySlot:
        slotIndex >= 0
          ? cleanValue(
              row[slotIndex]
            )
          : "",

      deliveryType:
        rowDeliveryType,

      dayLabel:
        dayLabel,

      deliveryDateLabel:
        deliveryDateLabel,

      total:
        totalIndex >= 0
          ? parseNumber(
              row[totalIndex]
            )
          : 0,

      status:
        status,

      items:
        itemMap[orderId] ||
        []
    });
  }


  orders.reverse();


  return orders;
}


/* =========================================================
   ORDER ITEMS MAP
========================================================= */

function getOrderItemsMap() {

  const sheet =
    getSheet(
      CONFIG.SHEETS.ORDER_ITEMS
    );


  const data =
    getAllRows(
      sheet
    );


  if (
    data.rows.length === 0
  ) {

    return {};
  }


  const headers =
    data.headers;


  const orderIdIndex =
    findColumn(
      headers,
      [
        "Order ID",
        "OrderId"
      ]
    );


  const productIdIndex =
    findColumn(
      headers,
      [
        "Product ID",
        "ProductId",
        "ID"
      ]
    );


  const productIndex =
    findColumn(
      headers,
      [
        "Product",
        "Name"
      ]
    );


  const priceIndex =
    findColumn(
      headers,
      [
        "Price",
        "Unit Price"
      ]
    );


  const quantityIndex =
    findColumn(
      headers,
      [
        "Quantity",
        "Qty"
      ]
    );


  const totalIndex =
    findColumn(
      headers,
      [
        "Total",
        "Line Total"
      ]
    );


  const statusIndex =
    findColumn(
      headers,
      [
        "Status"
      ]
    );


  const result =
    {};


  for (
    let i = 0;
    i < data.rows.length;
    i++
  ) {

    const row =
      data.rows[i];


    const orderId =
      orderIdIndex >= 0
        ? cleanValue(
            row[orderIdIndex]
          )
        : "";


    if (!orderId) {

      continue;
    }


    const status =
      statusIndex >= 0
        ? cleanValue(
            row[statusIndex]
          )
        : CONFIG.ACTIVE_STATUS;


    /*
     * Only Active items are returned.
     */
    if (
      status.toLowerCase() !==
      CONFIG.ACTIVE_STATUS.toLowerCase()
    ) {

      continue;
    }


    if (
      !result[orderId]
    ) {

      result[orderId] =
        [];
    }


    result[orderId].push({

      id:
        productIdIndex >= 0
          ? row[productIdIndex]
          : "",

      productId:
        productIdIndex >= 0
          ? row[productIdIndex]
          : "",

      name:
        productIndex >= 0
          ? cleanValue(
              row[productIndex]
            )
          : "",

      product:
        productIndex >= 0
          ? cleanValue(
              row[productIndex]
            )
          : "",

      qty:
        quantityIndex >= 0
          ? parseNumber(
              row[quantityIndex]
            )
          : 0,

      quantity:
        quantityIndex >= 0
          ? parseNumber(
              row[quantityIndex]
            )
          : 0,

      price:
        priceIndex >= 0
          ? parseNumber(
              row[priceIndex]
            )
          : 0,

      total:
        totalIndex >= 0
          ? parseNumber(
              row[totalIndex]
            )
          : 0,

      status:
        status
    });
  }


  return result;
}


/* =========================================================
   CANCEL ORDER
========================================================= */

function cancelOrder(
  payload
) {

  if (!payload) {

    throw new Error(
      "Cancellation data is missing."
    );
  }


  const orderId =
    cleanValue(
      payload.orderId ||
      payload.id ||
      ""
    );


  if (!orderId) {

    throw new Error(
      "Order ID is required."
    );
  }


  let userId =
    cleanValue(
      payload.userId ||
      ""
    );


  if (
    payload.phone ||
    payload.phoneNumber ||
    payload.mobile
  ) {

    userId =
      generateUserId(
        payload.phone ||
        payload.phoneNumber ||
        payload.mobile
      );
  }


  if (!userId) {

    throw new Error(
      "User ID is required."
    );
  }


  const now =
    new Date();


  const hour =
    getCurrentHour();


  const minute =
    getCurrentMinute();


  const todayKey =
    formatDateKey(
      now
    );


  const sheet =
    getSheet(
      CONFIG.SHEETS.ORDERS
    );


  const data =
    getAllRows(
      sheet
    );


  const headers =
    data.headers;


  const orderIdIndex =
    findColumn(
      headers,
      [
        "Order ID",
        "OrderId",
        "ID"
      ]
    );


  const statusIndex =
    findColumn(
      headers,
      [
        "Status"
      ]
    );


  const userIdIndex =
    findColumn(
      headers,
      [
        "User ID",
        "UserID"
      ]
    );


  const updateIndex =
    findColumn(
      headers,
      [
        "Update",
        "Updated At"
      ]
    );


  const createdIndex =
    findColumn(
      headers,
      [
        "Created At",
        "CreatedAt",
        "Date"
      ]
    );


  const deliveryTypeIndex =
    findColumn(
      headers,
      [
        "Delivery Type",
        "DeliveryType"
      ]
    );


  if (
    orderIdIndex < 0 ||
    statusIndex < 0 ||
    userIdIndex < 0
  ) {

    throw new Error(
      "Orders sheet is missing required columns."
    );
  }


  for (
    let i = 0;
    i < data.rows.length;
    i++
  ) {

    const row =
      data.rows[i];


    const rowOrderId =
      cleanValue(
        row[orderIdIndex]
      );


    if (
      rowOrderId !==
      orderId
    ) {

      continue;
    }


    const rowUserId =
      cleanValue(
        row[userIdIndex]
      );


    if (
      rowUserId !==
      userId
    ) {

      throw new Error(
        "Order does not belong to this customer."
      );
    }


    const currentStatus =
      cleanValue(
        row[statusIndex]
      );


    if (
      currentStatus.toLowerCase() !==
      CONFIG.ACTIVE_STATUS.toLowerCase()
    ) {

      throw new Error(
        "This order is no longer active."
      );
    }


    const rowDeliveryType =
      (
        deliveryTypeIndex >= 0 &&
        cleanValue(
          row[deliveryTypeIndex]
        )
      ) ||
      CONFIG.DELIVERY_TYPES.NEXT_DAY;


    /*
     * Once the calendar date has moved past the day this order was
     * placed, it has already been sent to the bakery - cancellation
     * closes permanently, regardless of the time of day. This is
     * what actually fixes the "reopens after midnight" bug: the old
     * check only compared the current hour to a fixed cutoff, so
     * once the clock rolled past midnight the hour dropped back
     * below the cutoff and cancellation looked open again.
     */
    if (
      createdIndex >= 0 &&
      Object.prototype.toString.call(
        row[createdIndex]
      ) ===
      "[object Date]" &&
      formatDateKey(
        row[createdIndex]
      ) !==
      todayKey
    ) {

      throw new Error(
        "This order can no longer be cancelled - it has already been sent to the bakery."
      );
    }


    if (
      rowDeliveryType ===
      CONFIG.DELIVERY_TYPES.SAME_DAY
    ) {

      /*
       * Same-day orders close for cancellation at the same
       * cutoff they closed for ordering.
       */
      if (
        hour >=
        CONFIG.SAME_DAY_CUTOFF_HOUR
      ) {

        throw new Error(
          "Same-day orders cannot be cancelled after 5:00 PM."
        );
      }

    } else {

      const cutoffPassed =
        hour >
        CONFIG.NEXT_DAY_CANCEL_CUTOFF_HOUR ||
        (
          hour ===
          CONFIG.NEXT_DAY_CANCEL_CUTOFF_HOUR &&
          minute >=
          CONFIG.NEXT_DAY_CANCEL_CUTOFF_MINUTE
        );

      if (cutoffPassed) {

        throw new Error(
          "Orders cannot be cancelled after 11:59 PM."
        );
      }
    }


    const sheetRow =
      i + 2;


    /*
     * Change Orders.Status.
     */
    sheet
      .getRange(
        sheetRow,
        statusIndex + 1
      )
      .setValue(
        CONFIG.CANCELLED_STATUS
      );


    if (
      updateIndex >= 0
    ) {

      sheet
        .getRange(
          sheetRow,
          updateIndex + 1
        )
        .setValue(
          new Date()
        );
    }


    SpreadsheetApp.flush();


    /*
     * App-side cancellation must remove this order's
     * OrderItems immediately.
     *
     * Do NOT rely on the spreadsheet onEdit trigger here:
     * the Orders.Status change is made by the web app itself.
     */
    const deletedOrderItems =
      deleteOrderItemsForOrder(
        orderId
      );

    Logger.log(
      "Cancelled order " +
      orderId +
      ". Deleted OrderItems: " +
      deletedOrderItems
    );


    SpreadsheetApp.flush();


    return {

      ok: true,

      orderId:
        orderId,

      userId:
        userId,

      status:
        CONFIG.CANCELLED_STATUS
    };
  }


  throw new Error(
    "Order not found."
  );
}


/* =========================================================
   USER ID MIGRATION
========================================================= */

function migrateCustomers() {

  const sheet =
    getSheet(
      CONFIG.SHEETS.CUSTOMERS
    );


  const userIdIndex =
    ensureHeader(
      sheet,
      "User ID"
    );


  const nameIndex =
    ensureHeader(
      sheet,
      "Name"
    );


  const phoneIndex =
    ensureHeader(
      sheet,
      "Phone"
    );


  const addressIndex =
    ensureHeader(
      sheet,
      "Address"
    );


  const updatedIndex =
    ensureHeader(
      sheet,
      "Updated At"
    );


  const data =
    getAllRows(
      sheet
    );


  if (
    data.rows.length === 0
  ) {

    return;
  }


  sheet
    .getRange(
      2,
      phoneIndex + 1,
      data.rows.length,
      1
    )
    .setNumberFormat("@");


  for (
    let i = 0;
    i < data.rows.length;
    i++
  ) {

    const phone =
      normalizePhone(
        data.rows[i][phoneIndex]
      );


    if (!phone) {

      continue;
    }


    const userId =
      generateUserId(
        phone
      );


    sheet
      .getRange(
        i + 2,
        phoneIndex + 1
      )
      .setNumberFormat("@")
      .setValue(
        phone
      );


    sheet
      .getRange(
        i + 2,
        userIdIndex + 1
      )
      .setValue(
        userId
      );
  }


  SpreadsheetApp.flush();
}


/* =========================================================
   MIGRATE ORDERS
========================================================= */

function migrateOrders() {

  const sheet =
    getSheet(
      CONFIG.SHEETS.ORDERS
    );


  const userIdIndex =
    ensureHeader(
      sheet,
      "User ID"
    );


  const phoneIndex =
    ensureHeader(
      sheet,
      "Phone"
    );


  const data =
    getAllRows(
      sheet
    );


  if (
    data.rows.length === 0
  ) {

    return;
  }


  sheet
    .getRange(
      2,
      phoneIndex + 1,
      data.rows.length,
      1
    )
    .setNumberFormat("@");


  for (
    let i = 0;
    i < data.rows.length;
    i++
  ) {

    const phone =
      normalizePhone(
        data.rows[i][phoneIndex]
      );


    if (!phone) {

      continue;
    }


    const userId =
      generateUserId(
        phone
      );


    sheet
      .getRange(
        i + 2,
        phoneIndex + 1
      )
      .setNumberFormat("@")
      .setValue(
        phone
      );


    sheet
      .getRange(
        i + 2,
        userIdIndex + 1
      )
      .setValue(
        userId
      );
  }


  SpreadsheetApp.flush();
}


/* =========================================================
   DEDUPLICATE CUSTOMERS
========================================================= */

function deduplicateCustomers() {

  const sheet =
    getSheet(
      CONFIG.SHEETS.CUSTOMERS
    );


  const userIdIndex =
    ensureHeader(
      sheet,
      "User ID"
    );


  const phoneIndex =
    ensureHeader(
      sheet,
      "Phone"
    );


  const nameIndex =
    ensureHeader(
      sheet,
      "Name"
    );


  const addressIndex =
    ensureHeader(
      sheet,
      "Address"
    );


  const updatedIndex =
    ensureHeader(
      sheet,
      "Updated At"
    );


  const data =
    getAllRows(
      sheet
    );


  const seen =
    {};


  const duplicates =
    [];


  for (
    let i = 0;
    i < data.rows.length;
    i++
  ) {

    const row =
      data.rows[i];


    const phone =
      normalizePhone(
        row[phoneIndex]
      );


    if (!phone) {

      continue;
    }


    const userId =
      generateUserId(
        phone
      );


    const rowNumber =
      i + 2;


    sheet
      .getRange(
        rowNumber,
        phoneIndex + 1
      )
      .setNumberFormat("@")
      .setValue(
        phone
      );


    sheet
      .getRange(
        rowNumber,
        userIdIndex + 1
      )
      .setValue(
        userId
      );


    if (
      !seen[userId]
    ) {

      seen[userId] =
        rowNumber;

      continue;
    }


    const masterRow =
      seen[userId];


    const name =
      cleanValue(
        row[nameIndex]
      );


    const address =
      cleanValue(
        row[addressIndex]
      );


    if (
      name
    ) {

      sheet
        .getRange(
          masterRow,
          nameIndex + 1
        )
        .setValue(
          name
        );
    }


    if (
      address
    ) {

      sheet
        .getRange(
          masterRow,
          addressIndex + 1
        )
        .setValue(
          address
        );
    }


    sheet
      .getRange(
        masterRow,
        updatedIndex + 1
      )
      .setValue(
        new Date()
      );


    duplicates.push(
      rowNumber
    );
  }


  duplicates
    .sort(
      function(a, b) {

        return b - a;
      }
    );


  duplicates.forEach(
    function(rowNumber) {

      sheet.deleteRow(
        rowNumber
      );
    }
  );


  SpreadsheetApp.flush();
}


/* =========================================================
   RUN USER ID MIGRATION
========================================================= */

/*
 * This is a one-time data migration (backfilling User ID / normalized
 * phone columns onto existing rows), not something new orders need.
 * The old code ran it - full sheet scan, one write call per row - on
 * every "orders" load and every "createOrder". Now it runs once and
 * remembers via a script property. To force it to run again (e.g.
 * after manually editing the sheet), delete the "userIdMigrationDone"
 * script property, or call repairUserData()/initializeSystem()
 * directly from the Apps Script editor.
 */
function runUserIdMigration() {

  const props =
    PropertiesService.getScriptProperties();

  if (
    props.getProperty("userIdMigrationDone") ===
    "true"
  ) {
    return;
  }

  migrateCustomers();

  migrateOrders();

  deduplicateCustomers();

  SpreadsheetApp.flush();

  props.setProperty(
    "userIdMigrationDone",
    "true"
  );
}


/* =========================================================
   INITIALIZE SYSTEM
========================================================= */

/*
 * RUN THIS ONCE MANUALLY AFTER DEPLOYING THIS VERSION.
 *
 * It:
 *
 * 1. Creates missing columns.
 * 2. Creates the installable trigger.
 * 3. Migrates User IDs.
 * 4. Synchronizes existing OrderItems.
 * 5. Deletes non-active OrderItems.
 */

function initializeSystem() {

  setupSystem();

  /*
   * Ensure the automatic Orders.Status -> OrderItems.Status
   * synchronization trigger exists after every initialization.
   */
  installOrderStatusTrigger();

  runUserIdMigration();

  synchronizeAllOrderItemStatuses();

  cleanupInactiveOrderItems();

  SpreadsheetApp.flush();


  return {

    ok: true,

    message:
      "MoharamBake initialized successfully. Automatic Order Status trigger is active."
  };
}


/* =========================================================
   REPAIR EVERYTHING
========================================================= */

function repairUserData() {

  setupSystem();

  runUserIdMigration();

  synchronizeAllOrderItemStatuses();

  cleanupInactiveOrderItems();

  SpreadsheetApp.flush();


  return {

    ok: true,

    message:
      "Customers, Orders and OrderItems repaired successfully."
  };
}


/* =========================================================
   MIGRATE ORDERITEM STATUS
========================================================= */

function migrateOrderItemStatuses() {

  setupSystem();

  synchronizeAllOrderItemStatuses();

  cleanupInactiveOrderItems();

  SpreadsheetApp.flush();


  return {

    ok: true,

    message:
      "OrderItem statuses synchronized successfully."
  };
}


/* =========================================================
   DATE SERIALIZATION
========================================================= */

function serializeDate(
  value
) {

  if (!value) {

    return "";
  }


  if (
    Object.prototype.toString.call(
      value
    ) ===
    "[object Date]"
  ) {

    return value.toISOString();
  }


  const parsed =
    new Date(
      value
    );


  if (
    !isNaN(
      parsed.getTime()
    )
  ) {

    return parsed.toISOString();
  }


  return String(
    value
  );
}


/* =========================================================
   WEB APP - GET
========================================================= */

function doGet(e) {

  try {

    const params =
      e &&
      e.parameter
        ? e.parameter
        : {};


    const action =
      String(
        params.action ||
        params.type ||
        params.request ||
        ""
      )
        .trim()
        .toLowerCase();


    /*
     * PRODUCTS
     */
    if (
      action === "products" ||
      action === "getproducts" ||
      action === "get_products"
    ) {

      setupSystem();

      /*
       * Products change rarely (you edit them by hand in the sheet).
       * getProductsCached() shares one 5-minute cache with
       * createOrder, so repeat app loads and order placement don't
       * hit the Sheets API for this at all.
       */
      return jsonResponse(
        getProductsCached()
      );
    }


    /*
     * ORDERS
     */
    if (
      action === "orders" ||
      action === "getorders" ||
      action === "get_orders"
    ) {

      setupSystem();

      runUserIdMigration();


      let userId =
        cleanValue(
          params.userId ||
          ""
        );


      const phone =
        params.phone ||
        params.phoneNumber ||
        params.mobile ||
        "";


      if (
        phone
      ) {

        userId =
          generateUserId(
            phone
          );
      }


      if (!userId) {

        return jsonResponse({

          ok: true,

          userId:
            "",

          orders:
            []
        });
      }


      const orders =
        getOrdersByUserId(
          userId
        );


      return jsonResponse({

        ok: true,

        userId:
          userId,

        orders:
          orders
      });
    }


    /*
     * HEALTH CHECK
     */
    return jsonResponse({

      ok: true,

      service:
        "MoharamBake API",

      version:
        "User ID v4 - Automatic OrderItem Status",

      availableActions: [

        "products",

        "orders",

        "createOrder",

        "cancelOrder"

      ]
    });


  } catch (error) {

    Logger.log(
      "GET ERROR: " +
      error.stack
    );


    return jsonResponse({

      ok: false,

      error:
        error.message ||
        String(error)
    });
  }
}


/* =========================================================
   WEB APP - POST
========================================================= */

function doPost(e) {

  try {

    if (
      !e ||
      !e.postData ||
      !e.postData.contents
    ) {

      throw new Error(
        "POST body is empty."
      );
    }


    const payload =
      JSON.parse(
        e.postData.contents
      );


    const action =
      String(
        payload.action ||
        payload.type ||
        payload.request ||
        ""
      )
        .trim()
        .toLowerCase();


    /*
     * CREATE ORDER
     */
    if (
      action === "createorder" ||
      action === "create_order" ||
      action === "order" ||
      action === "create"
    ) {

      setupSystem();

      runUserIdMigration();

      return jsonResponse(
        createOrder(
          payload
        )
      );
    }


    /*
     * CANCEL ORDER
     */
    if (
      action === "cancelorder" ||
      action === "cancel_order" ||
      action === "cancel" ||
      action === "deleteorder" ||
      action === "delete_order"
    ) {

      setupSystem();

      return jsonResponse(
        cancelOrder(
          payload
        )
      );
    }


    throw new Error(
      "Unknown POST action: " +
      action
    );


  } catch (error) {

    Logger.log(
      "POST ERROR: " +
      error.stack
    );


    return jsonResponse({

      ok: false,

      error:
        error.message ||
        String(error)
    });
  }
}


/* =========================================================
   TEST FUNCTIONS
========================================================= */

function testUserId() {

  const numbers = [

    "+201275122774",

    "00201275122774",

    "201275122774",

    "01275122774",

    "1275122774"

  ];


  numbers.forEach(
    function(phone) {

      Logger.log(
        phone +
        " -> " +
        normalizePhone(phone) +
        " -> " +
        generateUserId(phone)
      );
    }
  );
}


function testOrdersForUser() {

  const phone =
    "01275122774";


  const userId =
    generateUserId(
      phone
    );


  const orders =
    getOrdersByUserId(
      userId
    );


  Logger.log(
    JSON.stringify(
      orders,
      null,
      2
    )
  );
}


/* =========================================================
   TEST STATUS AUTOMATION
========================================================= */

/*
 * Put an actual Order ID here and run this manually
 * if you want to test the synchronization without
 * editing Google Sheets.
 */

function testOrderItemStatusSync() {

  const orderId =
    "MB-TEST";


  const updated =
    updateOrderItemsStatus(
      orderId,
      "Completed"
    );


  Logger.log(
    "Updated items: " +
    updated
  );
}


/* =========================================================
   CLEAN PHONE NUMBERS
========================================================= */

function cleanAllPhoneNumbers() {

  const sheetNames = [

    CONFIG.SHEETS.ORDERS,

    CONFIG.SHEETS.CUSTOMERS

  ];


  sheetNames.forEach(
    function(sheetName) {

      const sheet =
        getSheet(
          sheetName
        );


      const headers =
        getHeaders(
          sheet
        );


      const phoneIndex =
        findColumn(
          headers,
          [
            "Phone",
            "Phone Number",
            "Mobile",
            "Mobile Number"
          ]
        );


      if (
        phoneIndex < 0
      ) {

        return;
      }


      const lastRow =
        sheet.getLastRow();


      if (
        lastRow < 2
      ) {

        return;
      }


      const values =
        sheet
          .getRange(
            2,
            phoneIndex + 1,
            lastRow - 1,
            1
          )
          .getValues();


      sheet
        .getRange(
          2,
          phoneIndex + 1,
          lastRow - 1,
          1
        )
        .setNumberFormat("@");


      for (
        let i = 0;
        i < values.length;
        i++
      ) {

        const phone =
          normalizePhone(
            values[i][0]
          );


        if (
          phone
        ) {

          sheet
            .getRange(
              i + 2,
              phoneIndex + 1
            )
            .setNumberFormat("@")
            .setValue(
              phone
            );
        }
      }
    }
  );


  SpreadsheetApp.flush();


  return {

    ok: true,

    message:
      "Phone numbers normalized."
  };
}
