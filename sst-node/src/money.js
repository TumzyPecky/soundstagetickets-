function nairaToKobo(naira) {
  return Math.round(Number(naira) * 100);
}

function koboToNaira(kobo) {
  return Math.round(Number(kobo)) / 100;
}

function formatNaira(kobo) {
  return (koboToNaira(kobo)).toLocaleString("en-NG", {
    style: "currency",
    currency: "NGN",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

module.exports = { nairaToKobo, koboToNaira, formatNaira };
