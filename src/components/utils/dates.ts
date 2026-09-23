import { todayISO } from "./format";

const WEEKDAYS = [
    "Domingo",
    "Segunda-feira",
    "Terça-feira",
    "Quarta-feira",
    "Quinta-feira",
    "Sexta-feira",
    "Sábado",
];
const MONTHS = [
    "janeiro",
    "fevereiro",
    "março",
    "abril",
    "maio",
    "junho",
    "julho",
    "agosto",
    "setembro",
    "outubro",
    "novembro",
    "dezembro",
];

function parseISO(iso: string): Date | null {
    const [y, m, d] = String(iso || "").split("-").map(Number);
    if (!y || !m || !d) return null;
    return new Date(y, m - 1, d);
}

/** "2026-09-23" -> "23 de setembro" */
export function longDate(iso: string): string {
    const d = parseISO(iso);
    return d ? `${d.getDate()} de ${MONTHS[d.getMonth()]}` : String(iso || "");
}

/** "Hoje", "Ontem" ou o dia da semana ("Segunda-feira"). */
export function dayName(iso: string): string {
    const d = parseISO(iso);
    if (!d) return "";
    const today = parseISO(todayISO())!;
    const diff = Math.round((today.getTime() - d.getTime()) / 86400000);
    if (diff === 0) return "Hoje";
    if (diff === 1) return "Ontem";
    return WEEKDAYS[d.getDay()];
}

/** Data de hoje por extenso: "Quarta-feira, 23 de setembro de 2026". */
export function todayLong(): string {
    const d = new Date();
    return `${WEEKDAYS[d.getDay()]}, ${d.getDate()} de ${MONTHS[d.getMonth()]} de ${d.getFullYear()}`;
}
