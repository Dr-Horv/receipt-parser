import GmailThread = GoogleAppsScript.Gmail.GmailThread;

const grabNbrOfItemsAndTotal = (match: RegExpMatchArray, body: string) => {
  /*
        Only grab the next 4 lines here:
        ========== Slut Självskanning  ===========
        ------------------------------------------
          Totalt 13 varor
        Totalt    405,23 SEK

        to grab "Totalt N varror" and "Totalt NNN,NN SEK"
       */
  const linesAfter = 4;

  const startIndex = match.index + match[0].length; // Index after the end of the start marker
  const lines = body.substring(startIndex).split("\r\n"); // Split the text into lines
  const extractedLines = lines.slice(2, linesAfter).map((s) => s.trim()); // Join the first N lines

  return {
    nbrOfItemsLine: extractedLines[0],
    paymentLine: extractedLines[1],
  };
};

const extractReceiptInfo = (t: GmailThread) => {
  const body = t.getMessages()[0].getBody();
  console.log(body);

  //const regex = /========== Start Självskanning ===========\r\n([\s\S]*?)\r\n========== Slut Självskanning  ===========/;
  const regex =
    /========== Start Självskanning ===========([\S\s]*)========== Slut Självskanning  ===========/;
  const match = body.match(regex);
  if (match) {
    const matchedGroup = match[1];
    const { nbrOfItemsLine, paymentLine } = grabNbrOfItemsAndTotal(match, body);

    for (const l of matchedGroup.split("\r\n").filter((s) => s.length > 0)) {
      console.log(JSON.stringify(l));
    }
    return {
      itemLines: matchedGroup.split("\r\n").filter((s) => s.length > 0),
      nbrOfItemsLine,
      paymentLine,
    };
  } else {
    console.log("no match");
    return null;
  }
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

const calculateTotal = (price: number, extra: string[]) => {
  let endPrice = price;
  for (const e of extra) {
    if (containsPrice(e)) {
      let change = getPrice(e);
      endPrice += change;
    }
  }

  return endPrice;
};

const containsPrice = (l: string) => {
  return (
    l.length === "LÖK VIT EKO                          15,95".length &&
    !isNaN(parseInt(l[l.length - 1], 10))
  );
};

const processItemLines = (lines: string[]) => {
  const items = [];
  let name = "";
  let total = "";
  let extra: string[] = [];
  let price = NaN;
  // @ts-ignore
  const iterator = lines[Symbol.iterator]();

  let next = iterator.next();
  let l = next.value;
  while (!next.done) {
    if (/^[A-Za-z]/.test(l[0])) {
      // New item detected
      items.push({
        name,
        price,
        extra,
        total: extra.length > 0 ? calculateTotal(price, extra) : price,
      });

      name = l.split("  ")[0];
      total = "";
      extra = [];
      price = NaN;
      total = "";

      // Put all lines that does not contain a price as extra on item
      while (l !== undefined && !containsPrice(l)) {
        extra.push(l);
        next = iterator.next();
        l = next.value;
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

    next = iterator.next();
    l = next.value;
  }

  return items.slice(1);
};

const processThread = (t: GmailThread) => {
  const receiptInfo = extractReceiptInfo(t);
  const items = processItemLines(receiptInfo.itemLines);
  console.log(receiptInfo);
  for (const item of items) {
    console.log(item);
  }
};

const runInternal = () => {
  const threads = GmailApp.search(
    "from: hemkop@kund.hemkop.se subject: Här kommer ditt digitala kvitto",
    0,
    5,
  );
  for (const t of threads) {
    processThread(t);
  }
};

namespace Parser {
  export const run = () => runInternal();
}
