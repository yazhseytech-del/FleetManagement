import jsPDF from "jspdf";

// ---------- formatting helpers ----------
const fmtDate = (v) => {
  if (!v) return "____________";
  const d = new Date(v);
  if (isNaN(d)) return "____________";
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" });
};

const fmtTime = (v) => {
  if (!v) return "______";
  const d = new Date(v);
  if (isNaN(d)) return "______";
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
};

const fmtMoney = (n) =>
  `SGD ${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// ---------- low-level drawing helpers ----------

// A bordered box split into rows, each row split into cells (label above value).
// rows: [[{ label, value, width }, ...], ...]  — width is a 0..1 fraction of the box width.
function drawGridBox(doc, x, startY, width, rows, rowHeight = 12) {
  const totalHeight = rows.length * rowHeight;
  doc.setDrawColor(60);
  doc.setLineWidth(0.3);
  doc.rect(x, startY, width, totalHeight);

  rows.forEach((row, i) => {
    const rowY = startY + i * rowHeight;
    if (i > 0) doc.line(x, rowY, x + width, rowY);

    let cx = x;
    row.forEach((cell, j) => {
      const cellW = width * cell.width;
      if (j > 0) doc.line(cx, rowY, cx, rowY + rowHeight);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      doc.setTextColor(110);
      doc.text(cell.label, cx + 2.5, rowY + 4.5);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(9.5);
      doc.setTextColor(20);
      const lines = doc.splitTextToSize(cell.value || "", cellW - 5);
      doc.text(lines, cx + 2.5, rowY + 9);

      cx += cellW;
    });
  });

  return startY + totalHeight;
}

// Section heading: bold label, optional underline, small gap after.
function sectionHeading(doc, x, y, text, { underline = false } = {}) {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10.5);
  doc.setTextColor(20);
  doc.text(text, x, y);
  if (underline) {
    const w = doc.getTextWidth(text);
    doc.setLineWidth(0.3);
    doc.line(x, y + 1, x + w, y + 1);
  }
  return y + 6;
}

function bodyText(doc, x, y, text, size = 9) {
  doc.setFont("helvetica", "normal");
  doc.setFontSize(size);
  doc.setTextColor(50);
  doc.text(text, x, y);
  return y + 5.5;
}

// ---------- main export ----------

/**
 * Generates and downloads the Vehicle Rental Agreement PDF for a booking.
 * @param {object} booking - the created booking record
 * @param {object} car - the fleet record for booking.plate
 * @param {object} [companyInfo] - optional { companyName } override
 */
export function generateRentalAgreementPdf(booking, car, companyInfo = {}) {
  const companyName = companyInfo.companyName || "SG Wheels Pte Ltd";

  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageWidth = 210;
  const pageHeight = 297;
  const margin = 15;
  const contentWidth = pageWidth - margin * 2;
  let y = 18;

  // ---- Title ----
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.setTextColor(20);
  const title = "VEHICLE RENTAL AGREEMENT";
  const titleWidth = doc.getTextWidth(title);
  doc.text(title, pageWidth / 2, y, { align: "center" });
  doc.setLineWidth(0.4);
  doc.line(pageWidth / 2 - titleWidth / 2, y + 1.5, pageWidth / 2 + titleWidth / 2, y + 1.5);
  y += 10;

  // ---- Intro paragraph ----
  const agreementDate = booking.createdAt || booking.start || new Date().toISOString();
  const introLine1 = `This Vehicle Rental Agreement ("Agreement") is entered into on the ${fmtDate(agreementDate)},`;
  const introLine2 = `by and between ${companyName} ("Owner") and the Renter named below ("Hirer").`;
  y = bodyText(doc, margin, y, introLine1);
  y = bodyText(doc, margin, y, introLine2);
  y += 3;

  // ---- Renter details ----
  y = sectionHeading(doc, margin, y, "The details of the renter are as follows:");
  y = drawGridBox(doc, margin, y, contentWidth, [
    [
      { label: "Full Name", value: booking.customer, width: 0.6 },
      { label: "Contact Number", value: booking.contact, width: 0.4 },
    ],
    [
      { label: "NRIC / Passport No.", value: booking.ic || booking.passport, width: 0.6 },
      { label: "Name (Additional Driver)", value: (booking.additionalDrivers || [])[0]?.name || "", width: 0.4 },
    ],
    [
      { label: "Residential Address", value: booking.address, width: 0.6 },
      { label: "NRIC / Passport No. (Additional Driver)", value: (booking.additionalDrivers || [])[0]?.ic || "", width: 0.4 },
    ],
  ]);
  y += 8;

  // ---- 1. Vehicle Details ----
  y = sectionHeading(doc, margin, y, "1. Vehicle Details", { underline: true });
  y = bodyText(doc, margin, y, "Owner agrees to provide the following vehicle for rental to the Renter:");
  y += 1;
  y = drawGridBox(doc, margin, y, contentWidth, [
    [
      { label: "Make", value: car?.make || "", width: 0.33 },
      { label: "Model", value: car?.model || "", width: 0.34 },
      { label: "Vehicle Registration Number", value: car?.plate || booking.plate, width: 0.33 },
    ],
  ]);
  y += 8;

  // ---- 2. Rental Duration ----
  y = sectionHeading(doc, margin, y, "2. Rental Duration", { underline: true });
  y = bodyText(doc, margin, y, "The agreed rental period is as follows:");
  y += 1;
  y = drawGridBox(doc, margin, y, contentWidth, [
    [
      { label: "Start Date", value: fmtDate(booking.start), width: 0.3 },
      { label: "Start Time", value: fmtTime(booking.start), width: 0.2 },
      { label: "Pickup Location", value: booking.pickup, width: 0.5 },
    ],
    [
      { label: "End Date", value: fmtDate(booking.end), width: 0.3 },
      { label: "End Time", value: fmtTime(booking.end), width: 0.2 },
      { label: "Drop Location", value: booking.drop, width: 0.5 },
    ],
  ]);
  y += 8;

  // ---- Rental Fees ----
  const days = booking.start && booking.end
    ? Math.max(1, Math.round((new Date(booking.end) - new Date(booking.start)) / 86400000))
    : 0;
  const rentalCharge = (Number(booking.rate) || 0) * days;
  const vatAmount = rentalCharge * ((Number(booking.vatRate) || 0) / 100);
  const additionalDriverCharge = Number(booking.additionalDriverCharge) || 0;
  const deliveryCharge = Number(booking.deliveryCharge) || 0;
  const collectionCharge = Number(booking.collectionCharge) || 0;
  const otherCharges = Number(booking.otherCharges) || 0;
  const total = rentalCharge + vatAmount + additionalDriverCharge + deliveryCharge + collectionCharge + otherCharges;
  const deductible = Number(booking.deductible) || 0;

  y = sectionHeading(doc, margin, y, "Rental Fees", { underline: true });
  y = bodyText(doc, margin, y, "The Renter agrees to pay the rental charges and any applicable fees as outlined below:");
  y += 1;

  const feeRows = [
    ["Rental Vehicle Charges for Rental Period", fmtMoney(rentalCharge)],
    ["VAT / Surcharge", booking.vatRate ? fmtMoney(vatAmount) : "—"],
    ["Additional Driver Charge", additionalDriverCharge ? fmtMoney(additionalDriverCharge) : "—"],
    [`Delivery Charge (Location: ${booking.pickup || "-"})`, deliveryCharge ? fmtMoney(deliveryCharge) : "Free"],
    [`Collection Charge (Location: ${booking.drop || "-"})`, collectionCharge ? fmtMoney(collectionCharge) : "Free"],
    ["Others", otherCharges ? fmtMoney(otherCharges) : "—"],
  ];

  const feeRowH = 8;
  const labelColW = contentWidth * 0.72;
  const amountColW = contentWidth * 0.28;

  doc.setDrawColor(60);
  doc.setLineWidth(0.3);
  doc.rect(margin, y, contentWidth, feeRowH * feeRows.length);
  feeRows.forEach((row, i) => {
    const rowY = y + i * feeRowH;
    if (i > 0) doc.line(margin, rowY, margin + contentWidth, rowY);
    doc.line(margin + labelColW, rowY, margin + labelColW, rowY + feeRowH);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(40);
    doc.text(row[0], margin + 3, rowY + 5.5);
    doc.text(row[1], margin + labelColW + amountColW - 3, rowY + 5.5, { align: "right" });
  });
  y += feeRowH * feeRows.length;

  // Payment method row (checkboxes) + Total (bold)
  const paymentOptions = ["Cash", "PayNow", "Bank Transfer", "Fully Paid"];
  doc.rect(margin, y, contentWidth, feeRowH);
  doc.line(margin + labelColW, y, margin + labelColW, y + feeRowH);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(40);
  let cx = margin + 3;
  doc.text("Payment Method:", cx, y + 5.5);
  cx += doc.getTextWidth("Payment Method:") + 3;
  paymentOptions.forEach((opt) => {
    const checked = (booking.paymentMethod || "").toLowerCase() === opt.toLowerCase();
    doc.rect(cx, y + 2.7, 3, 3);
    if (checked) {
      doc.setFont("helvetica", "bold");
      doc.text("X", cx + 0.5, y + 5.1);
      doc.setFont("helvetica", "normal");
    }
    doc.text(opt, cx + 4.5, y + 5.5);
    cx += 4.5 + doc.getTextWidth(opt) + 5;
  });
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  doc.text("Total", margin + labelColW + 3, y + 5.5);
  doc.text(fmtMoney(total), margin + contentWidth - 3, y + 5.5, { align: "right" });
  y += feeRowH;

  // Security Deposit row
  doc.rect(margin, y, contentWidth, feeRowH);
  doc.line(margin + labelColW, y, margin + labelColW, y + feeRowH);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(40);
  doc.text("", margin + 3, y + 5.5);
  doc.setFont("helvetica", "bold");
  doc.text("Security Deposit", margin + labelColW + 3, y + 5.5);
  doc.text(fmtMoney(deductible), margin + contentWidth - 3, y + 5.5, { align: "right" });
  y += feeRowH + 8;

  // ---- Witness / illegal-use notice ----
  bodyText(doc, margin, y, "WITNESSED WHEREOF THE HANDS OF THE RESPECTIVE PARTIES ON THE DAY AND YEAR FIRST ABOVE WRITTEN", 8.5);
  y += 6;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  const notice = "Vehicle is not to be used for any illegal purposes at all times";
  const noticeWidth = doc.getTextWidth(notice);
  doc.text(notice, pageWidth / 2, y, { align: "center" });
  doc.line(pageWidth / 2 - noticeWidth / 2, y + 1, pageWidth / 2 + noticeWidth / 2, y + 1);
  y += 10;

  // ---- Renter's Confirmation ----
  y = sectionHeading(doc, margin, y, "Renter's Confirmation:");
  y = bodyText(doc, margin, y, "I confirm that the above vehicle has been returned in accordance with the terms of this Agreement.");
  y += 6;

  // ---- Footer: Vehicle Return | Accepted by Renter ----
  const colW = contentWidth / 2 - 5;
  const leftX = margin;
  const rightX = margin + contentWidth / 2 + 5;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  doc.text("VEHICLE RETURN", leftX, y);
  doc.text("ACCEPTED BY RENTER", rightX, y);
  y += 10;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setDrawColor(60);

  doc.text("Returned Date:", leftX, y);
  doc.line(leftX + 24, y + 0.8, leftX + colW, y + 0.8);
  doc.line(rightX + colW - 30, y - 6, rightX + colW, y - 6); // signature line
  y += 9;

  doc.text("Returned Time:", leftX, y);
  doc.line(leftX + 24, y + 0.8, leftX + colW, y + 0.8);
  doc.text("Name:", rightX, y);
  doc.text(booking.customer || "", rightX + 14, y);
  y += 9;

  doc.text("NRIC:", rightX, y);
  doc.text(booking.ic || booking.passport || "", rightX + 14, y);

  // Footer note
  if (y < pageHeight - 15) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(7.5);
    doc.setTextColor(140);
    doc.text(`Generated for booking ${booking.id || ""} — ${companyName}`, margin, pageHeight - 10);
  }

  doc.save(`Rental-Agreement-${car?.plate || booking.plate || "vehicle"}-${booking.id || Date.now()}.pdf`);
  return doc;
}