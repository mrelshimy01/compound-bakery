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

function getSpreadsheet() {

  return SpreadsheetApp.openById(
    CONFIG.SPREADSHEET_ID
  );
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

function setupSystem() {

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
      products
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

  const userIdIndex =
    ensureHeader(
      sheet,
      "User ID"
    );


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


  if (
    existingRow !== -1
  ) {

    sheet
      .getRange(
        existingRow,
        nameIndex + 1
      )
      .setValue(
        customer.name ||
        ""
      );


    sheet
      .getRange(
        existingRow,
        phoneIndex + 1
      )
      .setNumberFormat("@")
      .setValue(
        phone
      );


    sheet
      .getRange(
        existingRow,
        addressIndex + 1
      )
      .setValue(
        customer.address ||
        ""
      );


    sheet
      .getRange(
        existingRow,
        updatedIndex + 1
      )
      .setValue(
        now
      );


    sheet
      .getRange(
        existingRow,
        userIdIndex + 1
      )
      .setValue(
        userId
      );


    SpreadsheetApp.flush();

    return;
  }


  const headers =
    getHeaders(
      sheet
    );


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
    getProducts();


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


    const orderIdIndex =
      ensureHeader(
        ordersSheet,
        "Order ID"
      );


    const createdIndex =
      ensureHeader(
        ordersSheet,
        "Created At"
      );


    const nameIndex =
      ensureHeader(
        ordersSheet,
        "Name"
      );


    const phoneIndex =
      ensureHeader(
        ordersSheet,
        "Phone"
      );


    const addressIndex =
      ensureHeader(
        ordersSheet,
        "Address"
      );


    const slotIndex =
      ensureHeader(
        ordersSheet,
        "Delivery Slot"
      );


    const totalIndex =
      ensureHeader(
        ordersSheet,
        "Total"
      );


    const statusIndex =
      ensureHeader(
        ordersSheet,
        "Status"
      );


    const updateIndex =
      ensureHeader(
        ordersSheet,
        "Update"
      );


    const userIdIndex =
      ensureHeader(
        ordersSheet,
        "User ID"
      );


    const headers =
      getHeaders(
        ordersSheet
      );


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


  const orderIdIndex =
    ensureHeader(
      sheet,
      "Order ID"
    );


  const productIdIndex =
    ensureHeader(
      sheet,
      "Product ID"
    );


  const productIndex =
    ensureHeader(
      sheet,
      "Product"
    );


  const priceIndex =
    ensureHeader(
      sheet,
      "Price"
    );


  const quantityIndex =
    ensureHeader(
      sheet,
      "Quantity"
    );


  const totalIndex =
    ensureHeader(
      sheet,
      "Total"
    );


  /*
   * IMPORTANT NEW COLUMN.
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


  const timezone =
    Session.getScriptTimeZone() ||
    CONFIG.TIMEZONE;


  const hour =
    Number(
      Utilities.formatDate(
        now,
        timezone,
        "H"
      )
    );


  /*
   * Cancellation is allowed before 10 PM only.
   */
  if (
    hour >= 22
  ) {

    throw new Error(
      "Orders cannot be cancelled after 10 PM."
    );
  }


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

function runUserIdMigration() {

  migrateCustomers();

  migrateOrders();

  deduplicateCustomers();

  SpreadsheetApp.flush();
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

      return jsonResponse(
        getProducts()
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