import { anyNull, flattenArgs, nonNullValues, toNumber } from './shared';
import type { BuiltinFunctionMap } from './shared';

function pmtFormula(pv: number, r: number, n: number): number {
  if (r === 0) return pv / n;
  const growth = Math.pow(1 + r, n);
  return (pv * growth * r) / (growth - 1);
}

function loanWindow(
  principal: number,
  annualRate: number,
  monthlyPayment: number,
  firstMonth: number,
  months: number,
  kind: 'interest' | 'principal'
): number {
  const r = annualRate / 12;
  if (monthlyPayment <= principal * r) return 0;
  let bal = principal;
  const total = Math.trunc(months);
  const start = Math.max(1, Math.trunc(firstMonth));
  let sum = 0;
  const last = start + total;
  for (let m = 1; m < last; m++) {
    if (bal <= 0) break;
    const interest = bal * r;
    const principalPaid = monthlyPayment - interest;
    if (m >= start) {
      sum += kind === 'interest' ? interest : Math.max(0, principalPaid);
    }
    bal -= principalPaid;
  }
  return sum;
}

function pow1p(r: number, n: number): number {
  let acc = 1;
  const nn = Math.trunc(n);
  for (let i = 0; i < nn; i++) acc *= 1 + r;
  return acc;
}

function paymentAt(pv: number, r: number, n: number): number {
  const fv = pow1p(r, n);
  return pv / ((1 - 1 / fv) / r);
}

function aprFormula(principal: number, payment: number, n: number): number {
  const ni = Math.trunc(n);
  const base = principal / ni;
  let x = 0.05;
  let y = paymentAt(principal, x, ni);
  for (let i = 1; i <= 500; i++) {
    if (Number.isNaN(y) || y === base) return 0;
    x = x * ((payment - base) / (y - base));
    y = paymentAt(principal, x, ni);
    if (Math.abs(payment - y) < 0.005) break;
  }
  if (Number.isNaN(y) || y === base) return 0;
  return x * 12;
}

export const MATH_FUNCTIONS: BuiltinFunctionMap = {
  abs: (args) => Math.abs(toNumber(args[0])),
  avg: (args) => {
    const nums = nonNullValues(args).map(toNumber);
    if (nums.length === 0) return 0;
    return nums.reduce((s, v) => s + v, 0) / nums.length;
  },
  ceil: (args) => Math.ceil(toNumber(args[0])),
  floor: (args) => Math.floor(toNumber(args[0])),
  round: (args) => {
    const val = toNumber(args[0]);
    let places = 0;
    if (args.length > 1 && args[1] != null) {
      const p = toNumber(args[1]);
      if (Number.isFinite(p)) places = Math.trunc(p);
    }
    if (places < 0) places = 0;
    if (places > 12) places = 12;
    if (places === 0) {
      let r = Math.floor(val + 0.5);
      if (r < 0) r = -r;
      const out = r * (val >= 0 ? 1 : -1);
      return out === 0 ? 0 : out;
    }
    return Number(val.toFixed(places));
  },
  max: (args) => {
    const nums = nonNullValues(args).map(toNumber);
    if (nums.length === 0) return 0;
    return Math.max(...nums);
  },
  min: (args) => {
    const nums = nonNullValues(args).map(toNumber);
    if (nums.length === 0) return 0;
    return Math.min(...nums);
  },
  pow: (args) => Math.pow(toNumber(args[0]), toNumber(args[1])),
  sqrt: (args) => Math.sqrt(toNumber(args[0])),
  sin: (args) => Math.sin(toNumber(args[0])),
  cos: (args) => Math.cos(toNumber(args[0])),
  tan: (args) => Math.tan(toNumber(args[0])),
  asin: (args) => Math.asin(toNumber(args[0])),
  acos: (args) => Math.acos(toNumber(args[0])),
  atan: (args) => Math.atan(toNumber(args[0])),
  atan2: (args) => Math.atan2(toNumber(args[0]), toNumber(args[1])),
  exp: (args) => Math.exp(toNumber(args[0])),
  ln: (args) => Math.log(toNumber(args[0])),
  log: (args) => Math.log(toNumber(args[0])),
  log10: (args) => Math.log10(toNumber(args[0])),
  sign: (args) => Math.sign(toNumber(args[0])),
  random: () => Math.random(),
  mod: (args) => toNumber(args[0]) % toNumber(args[1]),

  sum: (args) => nonNullValues(args).reduce<number>((s, v) => s + toNumber(v), 0),
  count: (args) => nonNullValues(args).length,

  frac: (args) => {
    const n = toNumber(args[0]);
    return n - Math.floor(n);
  },
  integer: (args) => Math.floor(toNumber(args[0])),
  float: (args) => toNumber(args[0]),

  pi: () => Math.PI,
  deg2rad: (args) => (toNumber(args[0]) * Math.PI) / 180,
  rad2deg: (args) => (toNumber(args[0]) * 180) / Math.PI,

  apr: (args) => {
    if (anyNull(args)) return null;
    const principal = toNumber(args[0]);
    const payment = toNumber(args[1]);
    const nper = toNumber(args[2]);
    if (principal <= 0 || payment <= 0 || !(Math.trunc(nper) >= 1)) return NaN;
    return aprFormula(principal, payment, nper);
  },
  cterm: (args) => {
    if (anyNull(args)) return null;
    const rate = toNumber(args[0]);
    const fv = toNumber(args[1]);
    const pv = toNumber(args[2]);
    if (rate <= 0 || fv <= 0 || pv <= 0) return NaN;
    return Math.log(fv / pv) / Math.log(1 + rate);
  },
  fv: (args) => {
    if (anyNull(args)) return null;
    const payment = toNumber(args[0]);
    const rate = toNumber(args[1]);
    const nper = toNumber(args[2]);
    if (payment <= 0 || nper <= 0 || rate < 0) return NaN;
    if (rate === 0) return payment * nper;
    return (payment * (Math.pow(1 + rate, nper) - 1)) / rate;
  },
  ipmt: (args) => {
    if (anyNull(args)) return null;
    const [principal, rate, payment, firstMonth, months] = args.map(toNumber);
    if (principal <= 0 || rate <= 0 || payment <= 0 || firstMonth < 0 || months < 0) return NaN;
    return loanWindow(principal, rate, payment, firstMonth, months, 'interest');
  },
  ppmt: (args) => {
    if (anyNull(args)) return null;
    const [principal, rate, payment, firstMonth, months] = args.map(toNumber);
    if (principal <= 0 || rate <= 0 || payment <= 0 || firstMonth < 0 || months < 0) return NaN;
    return loanWindow(principal, rate, payment, firstMonth, months, 'principal');
  },
  npv: (args) => {
    if (anyNull(args)) return null;
    const rate = toNumber(args[0]);
    if (rate <= 0) return NaN;
    const flows = flattenArgs(args.slice(1));
    let npv = 0;
    for (let i = 0; i < flows.length; i++) {
      npv += toNumber(flows[i]) / Math.pow(1 + rate, i + 1);
    }
    return npv;
  },
  pmt: (args) => {
    if (anyNull(args)) return null;
    const principal = toNumber(args[0]);
    const rate = toNumber(args[1]);
    const nper = toNumber(args[2]);
    if (principal <= 0 || nper <= 0 || rate < 0) return NaN;
    return pmtFormula(principal, rate, nper);
  },
  pv: (args) => {
    if (anyNull(args)) return null;
    const payment = toNumber(args[0]);
    const rate = toNumber(args[1]);
    const nper = toNumber(args[2]);
    if (nper <= 0 || rate < 0) return NaN;
    if (rate === 0) return payment * nper;
    return (payment * (1 - Math.pow(1 + rate, -nper))) / rate;
  },
  rate: (args) => {
    if (anyNull(args)) return null;
    const fv = toNumber(args[0]);
    const pv = toNumber(args[1]);
    const nper = toNumber(args[2]);
    if (fv <= 0 || pv <= 0 || nper <= 0) return NaN;
    return Math.pow(fv / pv, 1 / nper) - 1;
  },
  term: (args) => {
    if (anyNull(args)) return null;
    const payment = toNumber(args[0]);
    const rate = toNumber(args[1]);
    const fv = toNumber(args[2]);
    if (payment <= 0 || rate <= 0 || fv <= 0) return NaN;
    return Math.log(1 + (fv * rate) / payment) / Math.log(1 + rate);
  },
};
