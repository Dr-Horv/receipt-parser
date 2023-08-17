import GmailThread = GoogleAppsScript.Gmail.GmailThread;

interface SummaryInfo {
  nbrOfItems: string;
  payment: string;
  receiptExtras: string[];
}

const SEKRegex = /Totalt\s+(?<kronor>\d+),(?<oren>\d+)\s+SEK/;
const numberOfItemsRegex = /Totalt (?<items>\d+)\s+(\bvara\b|\bvaror\b)/;

const grabNbrOfItemsAndTotal = (
  match: RegExpMatchArray,
  body: string,
): SummaryInfo => {
  /*
        Grab the next lines here:
          ========== Slut Självskanning  ===========
          PANTRETUR                           -42,00
          PANTRETUR                           -34,00
          ------------------------------------------
            Totalt 24 varor
           Totalt    304,30 SEK
       */

  const startIndex = match.index! + match[0].length; // Index after the end of the start marker
  const rest = body.substring(startIndex);
  const lines = rest.split("\r\n").map((s) => s.trim()); // Split the text into lines
  const extras: string[] = [];
  for (const line of lines) {
    if (line.startsWith("---")) {
      break;
    } else {
      extras.push(line);
    }
  }

  const paymentMatch = rest.match(SEKRegex);

  return {
    receiptExtras: extras,
    // @ts-ignore
    nbrOfItems: rest.match(numberOfItemsRegex).groups.items,
    // @ts-ignore
    payment: `${paymentMatch.groups.kronor}.${paymentMatch.groups.oren}`,
  };
};

interface ReceiptInfo {
  itemLines: string[];
  nbrOfItems: string;
  payment: string;
  receiptExtras: string[];
  datetime: string;
}

const dateAndTimeRegEx = /(?<date>\d\d\d\d-\d\d-\d\d)\s+(?<time>\d\d:\d\d)/;

const grabDate = (body: string): string | undefined => {
  const line = body.split("\r\n").find((s) => s.includes("Kassa:"));
  if (line === undefined) {
    return undefined;
  }

  // "Kassa: 16/18             2023-08-05  13:10"
  const match = line.match(dateAndTimeRegEx);
  if (match && match.groups) {
    const date = match.groups.date;
    const time = match.groups.time;
    return date + "T" + time;
  }
};
const extractInfoFromBody = (body: string): ReceiptInfo | undefined => {
  console.log(body);

  //const regex = /========== Start Självskanning ===========\r\n([\s\S]*?)\r\n========== Slut Självskanning  ===========/;
  const regex =
    /========== Start Självskanning ===========([\S\s]*)========== Slut Självskanning  ===========/;
  const match = body.match(regex);
  if (match) {
    const matchedGroup = match[1];
    const datetime = grabDate(body);
    if (datetime === undefined) {
      console.log("Missing datetime info");
      return undefined;
    }
    const { nbrOfItems, payment, receiptExtras } = grabNbrOfItemsAndTotal(
      match,
      body,
    );

    for (const l of matchedGroup.split("\r\n").filter((s) => s.length > 0)) {
      console.log(JSON.stringify(l));
    }
    return {
      itemLines: matchedGroup.split("\r\n").filter((s) => s.length > 0),
      nbrOfItems,
      payment,
      datetime,
      receiptExtras,
    };
  } else {
    console.log("no match");
    return undefined;
  }
};

const extractReceiptInfo = (t: GmailThread): ReceiptInfo | undefined => {
  const body = t.getMessages()[0].getBody();
  return extractInfoFromBody(body);
};

const getPrice = (l: string) => {
  let price = "";
  let i = l.length - 1;
  while (l[i] !== " ") {
    price = l[i] + price;
    i--;
  }

  return parseFloat(price.replace(",", "."));
};

const calculateTotal = (price: number, extra: string[]): number => {
  let endPrice = price;
  for (const e of extra) {
    if (containsPrice(e)) {
      let change = getPrice(e);
      endPrice += change;
    }
  }

  return endPrice;
};

const containsPrice = (l: string): boolean => {
  return (
    l.length === "LÖK VIT EKO                          15,95".length &&
    !isNaN(parseInt(l[l.length - 1], 10))
  );
};

interface Item {
  name: string;
  price: number;
  extra: string[];
  total: number;
}

const processItemLines = (lines: string[]): Item[] => {
  const items: Item[] = [];
  let name = "";
  let extra: string[] = [];
  let price = NaN;
  // @ts-ignore
  const iterator = lines[Symbol.iterator]();

  let l: string | undefined = iterator.next().value;
  while (l !== undefined) {
    if (l[0] !== " ") {
      if (l.startsWith("Extrapris") && !containsPrice(l)) {
        l = iterator.next().value;
        continue;
      }

      // New item detected
      items.push({
        name,
        price,
        extra,
        total: calculateTotal(price, extra),
      });

      name = l.split("  ")[0];
      extra = [];
      price = NaN;

      // Put all lines that does not contain a price as extra on item
      while (l !== undefined && !containsPrice(l)) {
        extra.push(l);
        l = iterator.next().value;
      }

      if (l === undefined) {
        break;
      }

      price = getPrice(l);
    } else {
      /* Put lines that does not start with a letter as extra on item
               covers things as discounts, recycling cost etc that's applied after:

               APELSINJUICE 1,75L                   36,95
                 Klubbpris:10% BARA FÖR DIG!        -3,70

            */
      extra.push(l);
    }

    l = iterator.next().value;
  }
  items.push({
    name,
    price,
    extra,
    total: calculateTotal(price, extra),
  });

  return items.slice(1);
};

interface DataRow {
  id: string;
  datetime: string;
  itemName: string;
  itemPrice: number;
  itemExtras: string;
  itemTotal: number;
  receiptNumberOfItems: number;
  receiptTotal: number;
  receiptExtras: string;
}

interface ReceiptSummary {
  datetime: string;
  receiptTotal: number;
  numberOfItems: number;
  receiptExtras: string[];
}

const shortenWhitespace = (s: string): string => s.replace(/\s+/g, " ");

const toDataRows = (
  id: string,
  receiptSummary: ReceiptSummary,
  items: Item[],
): DataRow[] =>
  items.map((item) => ({
    id,
    datetime: receiptSummary.datetime,
    receiptTotal: receiptSummary.receiptTotal,
    receiptNumberOfItems: receiptSummary.numberOfItems,
    receiptExtras: receiptSummary.receiptExtras
      .map((s) => shortenWhitespace(s))
      .join(","),
    itemName: item.name,
    itemPrice: item.price,
    itemTotal: item.total,
    itemExtras: item.extra.map((s) => shortenWhitespace(s)).join(","),
  }));

const grabReceiptSummary = (receiptInfo: ReceiptInfo): ReceiptSummary => {
  console.log("paymentline", receiptInfo.payment);
  console.log("nbrOfItemsLine", receiptInfo.nbrOfItems);
  const receiptTotal = parseFloat(receiptInfo.payment);
  const numberOfItems = parseInt(receiptInfo.nbrOfItems);

  return {
    datetime: receiptInfo.datetime,
    receiptTotal,
    numberOfItems,
    receiptExtras: receiptInfo.receiptExtras,
  };
};

const processThread = (t: GmailThread) => {
  const receiptInfo = extractReceiptInfo(t);
  if (receiptInfo === undefined) {
    return;
  }
  const items = processItemLines(receiptInfo.itemLines);
  const receiptSummary = grabReceiptSummary(receiptInfo);
  console.log(receiptInfo);
  for (const item of items) {
    console.log(item);
  }

  const dataRows = toDataRows(t.getId(), receiptSummary, items);
  if (dataRows.length === 0) {
    return;
  }

  const spreadsheet = SpreadsheetApp.openByUrl(
    "https://docs.google.com/spreadsheets/d/1HZ_phhJZ5N4HM1lRL6AXY0zfEkqV1osjYV2O0E0CwWs/edit",
  );

  const sheet = spreadsheet.getSheetByName("DATA")!;
  const cols = Object.keys(dataRows[0]).length;
  sheet.getRange(1, 1, 1, cols).setValues([Object.keys(dataRows[0])]);
  const lastRow = sheet.getLastRow();

  sheet
    .getRange(lastRow + 1, 1, dataRows.length, cols)
    .setValues(dataRows.map((row) => Object.values(row)));
};

const runInternal = () => {
  const threads = GmailApp.search(
    `from: hemkop@kund.hemkop.se subject: "Här kommer ditt digitala kvitto"`,
    0,
    500,
  );
  for (const t of threads) {
    processThread(t);
  }
};

namespace Parser {
  export const run = () => runInternal();
}
