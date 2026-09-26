function buildTicketEmailHtml({ order, customer, event, items }) {
  const firstName = customer.fullName.split(" ")[0];
  const eventName = event ? event.name : "Soundstage Live Concert";
  const isVip = items.some((i) => /vip/i.test(i.ticketTypeName));
  const accentColor = isVip ? "#d4af37" : "#4f8bff";

  const dateStr = event && event.date ? new Date(event.date).toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" }) : "";
  const timeStr = event ? event.time || "" : "";
  const stateStr = event ? [event.city, event.state].filter(Boolean).join(", ") : "";
  const venueStr = event ? [event.venue, event.address].filter(Boolean).join(" — ") : "";

  const ticketRows = items
    .map(
      (i) => `
      <tr>
        <td style="padding:14px 0;border-bottom:1px solid #26314f;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="font-family:Arial,Helvetica,sans-serif;">
                <span style="display:inline-block;background:${/vip/i.test(i.ticketTypeName) ? "#d4af37" : "#4f8bff"};color:#0a0e1a;font-size:11px;font-weight:700;letter-spacing:0.03em;text-transform:uppercase;border-radius:4px;padding:3px 8px;margin-bottom:6px;">${i.ticketTypeName}</span><br/>
                <span style="font-family:Arial,Helvetica,sans-serif;color:#e7ecfb;font-size:14px;">Qty ${i.quantity} &nbsp;·&nbsp; Ticket${i.tickets.length > 1 ? "s" : ""}: <span style="font-family:'Courier New',monospace;color:#7dd3ff;">${i.tickets.join(", ")}</span></span>
              </td>
            </tr>
          </table>
        </td>
      </tr>`
    )
    .join("");

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Your Soundstage Ticket</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f5f7;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f5f7;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background-color:#0d111c;border-radius:16px;overflow:hidden;">

          <tr>
            <td style="background-color:#07090f;background-image:linear-gradient(120deg,#050a1a 0%,#0b1530 40%,#1a3a8f 100%);padding:28px 28px 24px;text-align:center;">
              <div style="font-family:Arial,Helvetica,sans-serif;font-size:19px;font-weight:800;color:#ffffff;letter-spacing:-0.01em;">Soundstage</div>
              <div style="font-family:Arial,Helvetica,sans-serif;font-size:10px;font-weight:600;color:#7dd3ff;letter-spacing:0.08em;text-transform:uppercase;margin-top:2px;">Live Concert Tickets</div>
            </td>
          </tr>

          <tr>
            <td style="background-color:${accentColor};padding:14px 28px;text-align:center;">
              <span style="font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;color:#0a0e1a;">✓ Payment Confirmed — You're Going!</span>
            </td>
          </tr>

          <tr>
            <td style="padding:28px;">
              <p style="font-family:Arial,Helvetica,sans-serif;font-size:20px;font-weight:700;color:#ffffff;margin:0 0 6px;">Hi ${escapeHtmlEmail(firstName)},</p>
              <p style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#a8b2c9;margin:0 0 24px;line-height:1.5;">Your order is confirmed and your ticket${items.length > 1 || items.some((i) => i.quantity > 1) ? "s are" : " is"} ready. Here's everything you need for the show.</p>

              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#131928;border:1px solid #26314f;border-radius:12px;margin-bottom:20px;">
                <tr>
                  <td style="padding:18px 20px;">
                    <p style="font-family:Arial,Helvetica,sans-serif;font-size:10px;font-weight:700;color:#7dd3ff;letter-spacing:0.06em;text-transform:uppercase;margin:0 0 4px;">Order Number</p>
                    <p style="font-family:'Courier New',monospace;font-size:15px;color:#ffffff;margin:0 0 16px;">${escapeHtmlEmail(order.orderNumber)}</p>

                    <p style="font-family:Arial,Helvetica,sans-serif;font-size:17px;font-weight:700;color:#ffffff;margin:0 0 10px;">${escapeHtmlEmail(eventName)}</p>

                    ${dateStr ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin-bottom:4px;"><tr><td style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#a8b2c9;padding-right:6px;">📅</td><td style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#e7ecfb;">${escapeHtmlEmail(dateStr)}${timeStr ? " · " + escapeHtmlEmail(timeStr) : ""}</td></tr></table>` : ""}
                    ${stateStr ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin-bottom:4px;"><tr><td style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#a8b2c9;padding-right:6px;">🗺️</td><td style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#e7ecfb;">${escapeHtmlEmail(stateStr)}</td></tr></table>` : ""}
                    ${venueStr ? `<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#a8b2c9;padding-right:6px;vertical-align:top;">📍</td><td style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#e7ecfb;line-height:1.4;">${escapeHtmlEmail(venueStr)}</td></tr></table>` : ""}
                  </td>
                </tr>
              </table>

              <p style="font-family:Arial,Helvetica,sans-serif;font-size:10px;font-weight:700;color:#7dd3ff;letter-spacing:0.06em;text-transform:uppercase;margin:0 0 4px;">Your Tickets</p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                ${ticketRows}
              </table>

              <p style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#a8b2c9;line-height:1.6;margin:24px 0 0;">Show this email or your ticket number at the door. Doors open early — get there ahead of the crowd.</p>
            </td>
          </tr>

          <tr>
            <td style="padding:18px 28px;border-top:1px solid #26314f;text-align:center;">
              <p style="font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#5c6787;margin:0;">This is an automated confirmation from Soundstage Live Concert.</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}