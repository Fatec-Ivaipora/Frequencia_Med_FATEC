import { Platform } from "react-native";

export type Aluno = { ra: string; nome: string };

/** RA sem espaços, no mesmo formato em que é lido do QR do aluno. */
export function normalizeRa(ra: string): string {
    return String(ra || "").replace(/\s+/g, "");
}

/**
 * Lê a lista de alunos colada do Excel ou de um CSV: uma linha por aluno,
 * com RA e nome separados por tab, ";" ou ",", em qualquer ordem.
 * Linhas sem RA (ex.: cabeçalho) são ignoradas; RAs repetidos ficam uma vez só.
 */
export function parseAlunos(text: string): { alunos: Aluno[]; ignored: number } {
    const byRa = new Map<string, Aluno>();
    let ignored = 0;

    for (const line of String(text || "").split(/\r?\n/)) {
        if (!line.trim()) continue;
        const cols = line
            .split(/\t|;|,/)
            .map((c) => c.replace(/"/g, "").trim())
            .filter(Boolean);

        const raIdx = cols.findIndex((c) => /^\d[\d.\-/]*$/.test(normalizeRa(c)));
        if (raIdx < 0) {
            ignored++;
            continue;
        }
        const ra = normalizeRa(cols[raIdx]);
        const nome = cols.filter((_, i) => i !== raIdx).join(" ").replace(/\s+/g, " ");
        byRa.set(ra, { ra, nome });
    }

    return { alunos: Array.from(byRa.values()), ignored };
}

/** Junta alunos novos na lista existente (mesmo RA: atualiza o nome, se veio). */
export function mergeAlunos(current: Aluno[], incoming: Aluno[]): Aluno[] {
    const map = new Map<string, Aluno>();
    for (const a of current || []) map.set(normalizeRa(a.ra), a);
    for (const a of incoming) {
        const prev = map.get(a.ra);
        map.set(a.ra, { ra: a.ra, nome: a.nome || prev?.nome || "" });
    }
    return Array.from(map.values()).sort((a, b) => a.nome.localeCompare(b.nome));
}

/** Web: abre o seletor de arquivo e devolve o texto de um .csv/.txt (null se cancelar). */
export function pickTextFileWeb(): Promise<string | null> {
    if (Platform.OS !== "web" || typeof document === "undefined") return Promise.resolve(null);
    return new Promise((resolve) => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".csv,.txt,text/csv,text/plain";
        input.onchange = () => {
            const file = input.files?.[0];
            if (!file) return resolve(null);
            // CSV salvo pelo Excel em PT-BR costuma vir em Windows-1252: se o UTF-8
            // estragar os acentos, lê de novo nessa codificação.
            const read = (encoding: string) =>
                new Promise<string>((ok, fail) => {
                    const reader = new FileReader();
                    reader.onload = () => ok(String(reader.result || ""));
                    reader.onerror = () => fail(reader.error);
                    reader.readAsText(file, encoding);
                });
            read("utf-8")
                .then((t) => (t.includes("�") ? read("windows-1252") : t))
                .then(resolve, () => resolve(null));
        };
        input.click();
    });
}
