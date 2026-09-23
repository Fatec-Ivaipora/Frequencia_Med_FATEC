import { Ionicons } from "@expo/vector-icons";
import { Picker } from "@react-native-picker/picker";
import { Stack, router } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
    FlatList,
    Platform,
    Pressable,
    RefreshControl,
    ScrollView,
    StyleSheet,
    Text,
    View,
    useWindowDimensions,
} from "react-native";

import { logout } from "../services/auth";
import { createPreceptor, deletePreceptor, listPreceptors } from "../services/preceptor";
import { listRollcalls } from "../services/rollcalls";
import { createTurma, listTurmas } from "../services/turmas";
import { createUBS, deleteUBS, listUBS } from "../services/ubs";
import { HeaderBrand, HeaderLogout } from "../ui/AppHeader";
import { AppModal } from "../ui/AppModal";
import { Button } from "../ui/Button";
import { SearchBox } from "../ui/SearchBox";
import { TurnoTag } from "../ui/TurnoTag";
import { EmptyState } from "../ui/EmptyState";
import { Field } from "../ui/Field";
import { IconButton } from "../ui/IconButton";
import { ScreenContainer } from "../ui/ScreenContainer";
import { Skeleton } from "../ui/Skeleton";
import { confirmAction, notify } from "../ui/feedback";
import { colors, radius, shadow, spacing, type } from "../ui/theme";
import { normalizeRa, parseAlunos, pickTextFileWeb } from "../utils/alunosImport";
import { dayName, longDate, todayLong } from "../utils/dates";
import { formatDateBR, normalizeSearch, shiftLabel, todayISO } from "../utils/format";

interface ManagementScreenProps {
    title: string;
}

type Period = "today" | "week" | "all";

const PERIODS: { key: Period; label: string }[] = [
    { key: "today", label: "Hoje" },
    { key: "week", label: "Últimos 7 dias" },
    { key: "all", label: "Todas" },
];

// Identifica a UBS/hospital da chamada (mesma chave usada no agrupamento dos cards).
const ubsKeyOf = (r: any) => normalizeSearch(r.ubsSlug || r.ubsName || "");

/** Tela de gestão usada pelo coordenador (/coordinator/list) e pelo admin (/admin). */
export function ManagementScreen({ title }: ManagementScreenProps) {
    const { width } = useWindowDimensions();
    const isWide = width >= 900;

    const [rollcalls, setRollcalls] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);

    const [query, setQuery] = useState("");
    const [period, setPeriod] = useState<Period>("today");
    const [ubsFilter, setUbsFilter] = useState(""); // "" = todos os locais

    // Locais (UBS/hospitais) que têm chamadas, para o filtro por local.
    const ubsOptions = useMemo(() => {
        const map = new Map<string, string>();
        for (const r of rollcalls) {
            const key = ubsKeyOf(r);
            if (key && !map.has(key)) map.set(key, String(r.ubsName || key));
        }
        return Array.from(map, ([key, name]) => ({ key, name })).sort((a, b) =>
            a.name.localeCompare(b.name)
        );
    }, [rollcalls]);

    // Se o local selecionado sumiu (ex.: após atualizar), volta para "todos".
    useEffect(() => {
        if (ubsFilter && !ubsOptions.some((o) => o.key === ubsFilter)) setUbsFilter("");
    }, [ubsOptions, ubsFilter]);

    // Filtro de local vale sempre. Busca ignora o período (procura no histórico todo);
    // sem busca, vale o filtro de período.
    const filteredRollcalls = useMemo(() => {
        const base = ubsFilter ? rollcalls.filter((r) => ubsKeyOf(r) === ubsFilter) : rollcalls;
        const q = normalizeSearch(query.trim());
        if (q) {
            return base.filter(
                (r) =>
                    normalizeSearch(r.ubsName).includes(q) ||
                    formatDateBR(r.date).includes(q) ||
                    normalizeSearch(shiftLabel(r.shift)).includes(q) ||
                    normalizeSearch(shiftLabel(r.turno || "")).includes(q)
            );
        }
        if (period === "today") {
            const today = todayISO();
            return base.filter((r) => String(r.date) === today);
        }
        if (period === "week") {
            const limit = new Date();
            limit.setDate(limit.getDate() - 7);
            const yyyy = limit.getFullYear();
            const mm = String(limit.getMonth() + 1).padStart(2, "0");
            const dd = String(limit.getDate()).padStart(2, "0");
            const limitISO = `${yyyy}-${mm}-${dd}`;
            return base.filter((r) => String(r.date) >= limitISO);
        }
        return base;
    }, [rollcalls, query, period, ubsFilter]);

    // Agrupa chamadas da mesma UBS, mesmo dia e mesmo turno (1ª e 2ª aula juntas).
    // Turnos diferentes (manhã/tarde) geram cards separados.
    const groupedRollcalls = useMemo(() => {
        const aulaOrder = (s: string) =>
            String(s || "").toLowerCase() === "aula2" || String(s || "").toLowerCase() === "tarde"
                ? 2
                : 1;
        // Chamadas antigas não têm o campo turno: usa o shift legado (manha/tarde)
        const turnoOf = (r: any) => {
            if (r.turno) return String(r.turno).toLowerCase();
            const s = String(r.shift || "").toLowerCase();
            return s === "manha" || s === "tarde" ? s : "";
        };
        const map = new Map<string, any>();
        for (const r of filteredRollcalls) {
            const turno = turnoOf(r);
            const key = `${ubsKeyOf(r)}|${r.date}|${turno}`;
            if (!map.has(key)) {
                map.set(key, { key, ubsName: r.ubsName, date: r.date, turno, items: [] });
            }
            map.get(key).items.push(r);
        }
        const groups = Array.from(map.values());
        for (const g of groups) {
            g.items.sort((a: any, b: any) => aulaOrder(a.shift) - aulaOrder(b.shift));
        }
        groups.sort((a, b) =>
            a.date === b.date
                ? String(a.ubsName).localeCompare(String(b.ubsName))
                : String(a.date) < String(b.date)
                  ? 1
                  : -1
        );
        return groups;
    }, [filteredRollcalls]);

    // Seções por dia (a lista já vem do mais recente pro mais antigo), com totais do dia.
    const daySections = useMemo(() => {
        const map = new Map<string, any[]>();
        for (const g of groupedRollcalls) {
            const d = String(g.date || "");
            if (!map.has(d)) map.set(d, []);
            map.get(d)!.push(g);
        }
        return Array.from(map, ([date, groups]) => ({
            date,
            groups,
            students: new Set(
                groups.flatMap((g: any) => g.items.flatMap((it: any) => it.ras || []))
            ).size,
        }));
    }, [groupedRollcalls]);

    const [ubsList, setUbsList] = useState<any[]>([]);
    const [ubsModal, setUbsModal] = useState(false);
    const [ubsName, setUbsName] = useState("");
    const [ubsError, setUbsError] = useState<string | null>(null);
    const [ubsSaving, setUbsSaving] = useState(false);
    const [ubsQuery, setUbsQuery] = useState("");

    const [preceptors, setPreceptors] = useState<any[]>([]);
    const [precModal, setPrecModal] = useState(false);
    const [precName, setPrecName] = useState("");
    const [precEmail, setPrecEmail] = useState("");
    const [precPass, setPrecPass] = useState("");
    const [precError, setPrecError] = useState<string | null>(null);
    const [precSaving, setPrecSaving] = useState(false);
    const [precQuery, setPrecQuery] = useState("");

    const [turmas, setTurmas] = useState<any[]>([]);
    const [turmaModal, setTurmaModal] = useState(false);
    const [turmaName, setTurmaName] = useState("");
    const [turmaText, setTurmaText] = useState("");
    const [turmaError, setTurmaError] = useState<string | null>(null);
    const [turmaSaving, setTurmaSaving] = useState(false);
    const turmaPreview = useMemo(() => parseAlunos(turmaText), [turmaText]);

    const [tab, setTab] = useState<"chamadas" | "turmas">("chamadas");

    // Resumo de cada turma: última chamada com alunos dela e quantos estavam presentes.
    const turmaSummaries = useMemo(
        () =>
            turmas.map((t) => {
                const ras = new Set((t.alunos || []).map((a: any) => normalizeRa(a.ra)));
                const presentByDate = new Map<string, Set<string>>();
                for (const r of rollcalls) {
                    for (const ra of r.ras || []) {
                        const n = normalizeRa(ra);
                        if (!ras.has(n)) continue;
                        const d = String(r.date || "");
                        if (!presentByDate.has(d)) presentByDate.set(d, new Set());
                        presentByDate.get(d)!.add(n);
                    }
                }
                const lastDate = Array.from(presentByDate.keys()).sort().pop() || "";
                return {
                    ...t,
                    total: ras.size,
                    lastDate,
                    lastPresent: lastDate ? presentByDate.get(lastDate)!.size : 0,
                };
            }),
        [turmas, rollcalls]
    );

    const filteredUbs = useMemo(() => {
        const q = normalizeSearch(ubsQuery.trim());
        if (!q) return ubsList;
        return ubsList.filter((u) => normalizeSearch(u.name).includes(q));
    }, [ubsList, ubsQuery]);

    const filteredPreceptors = useMemo(() => {
        const q = normalizeSearch(precQuery.trim());
        if (!q) return preceptors;
        return preceptors.filter(
            (p) => normalizeSearch(p.name).includes(q) || normalizeSearch(p.email).includes(q)
        );
    }, [preceptors, precQuery]);

    async function loadAll(asRefresh = false) {
        if (asRefresh) setRefreshing(true);
        else setLoading(true);
        try {
            const [calls, u, p, t] = await Promise.all([
                listRollcalls(),
                listUBS(),
                listPreceptors(),
                listTurmas(),
            ]);
            setRollcalls(calls);
            setUbsList(u);
            setPreceptors(p);
            setTurmas(t);
        } catch (e: any) {
            notify("error", e?.message || "Falha ao carregar os dados.");
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }

    useEffect(() => {
        loadAll();
    }, []);

    async function handleLogout() {
        await logout();
        router.replace("/login");
    }

    async function handleCreateUbs() {
        const name = ubsName.trim();
        if (!name) {
            setUbsError("Informe o nome da UBS.");
            return;
        }
        try {
            setUbsSaving(true);
            await createUBS(name);
            setUbsName("");
            setUbsError(null);
            notify("success", "UBS cadastrada.");
            await loadAll();
        } catch (e: any) {
            notify("error", e?.message || "Falha ao cadastrar a UBS.");
        } finally {
            setUbsSaving(false);
        }
    }

    async function handleDeleteUbs(id: string, name: string) {
        const ok = await confirmAction({
            title: "Excluir UBS",
            message: `Tem certeza que deseja excluir "${name}"? Esta ação não pode ser desfeita.`,
            confirmLabel: "Excluir",
            destructive: true,
        });
        if (!ok) return;
        try {
            await deleteUBS(id);
            notify("success", "UBS excluída.");
            await loadAll();
        } catch (e: any) {
            notify("error", e?.message || "Falha ao excluir a UBS.");
        }
    }

    async function handlePickAlunosFile() {
        const text = await pickTextFileWeb();
        if (text != null) {
            setTurmaText(text);
            if (turmaError) setTurmaError(null);
        }
    }

    async function handleCreateTurma() {
        const name = turmaName.trim();
        if (!name) {
            setTurmaError("Informe o nome da turma.");
            return;
        }
        if (turmas.some((t) => normalizeSearch(t.name) === normalizeSearch(name))) {
            setTurmaError(`Já existe uma turma "${name}".`);
            return;
        }
        if (!turmaPreview.alunos.length) {
            setTurmaError("Cole ou importe a lista de alunos (RA e nome).");
            return;
        }
        try {
            setTurmaSaving(true);
            await createTurma({ name, alunos: turmaPreview.alunos });
            setTurmaName("");
            setTurmaText("");
            setTurmaError(null);
            notify("success", `Turma ${name} cadastrada com ${turmaPreview.alunos.length} alunos.`);
            setTurmaModal(false);
            setTab("turmas");
            await loadAll();
        } catch (e: any) {
            notify("error", e?.message || "Falha ao cadastrar a turma.");
        } finally {
            setTurmaSaving(false);
        }
    }

    function openTurma(id: string) {
        router.push({ pathname: "/coordinator/turma", params: { turmaId: id } });
    }

    async function handleCreatePreceptor() {
        const name = precName.trim();
        const email = precEmail.trim().toLowerCase();
        const password = precPass.trim();

        if (!name || !email || !password) {
            setPrecError("Informe nome, e-mail e senha.");
            return;
        }
        if (password.length < 6) {
            setPrecError("A senha precisa ter pelo menos 6 caracteres.");
            return;
        }

        try {
            setPrecSaving(true);
            await createPreceptor({ name, email, password });
            setPrecName("");
            setPrecEmail("");
            setPrecPass("");
            setPrecError(null);
            notify("success", "Preceptor criado com acesso ao app.");
            await loadAll();
        } catch (e: any) {
            notify("error", e?.message || "Falha ao criar o preceptor.");
        } finally {
            setPrecSaving(false);
        }
    }

    async function handleDeletePreceptor(id: string, name: string) {
        const ok = await confirmAction({
            title: "Excluir preceptor",
            message: `Tem certeza que deseja excluir "${name}"? Esta ação não pode ser desfeita.`,
            confirmLabel: "Excluir",
            destructive: true,
        });
        if (!ok) return;
        try {
            await deletePreceptor(id);
            notify("success", "Preceptor excluído.");
            await loadAll();
        } catch (e: any) {
            notify("error", e?.message || "Falha ao excluir o preceptor.");
        }
    }

    return (
        <ScreenContainer scrollable={false}>
            <Stack.Screen
                options={{
                    title,
                    headerTitle: () => <HeaderBrand label={title} />,
                    headerRight: () => <HeaderLogout onPress={handleLogout} />,
                }}
            />

            <View style={[styles.container, isWide && styles.containerWide]}>
                {/* Cabeçalho: data de hoje, abas (que fazem o papel de título) e cadastros */}
                <View style={styles.pageHeader}>
                    <View style={styles.pageHeaderMain}>
                        <Text style={styles.todayText}>{todayLong()}</Text>
                        <View style={styles.tabs} accessibilityRole="tablist">
                            {(
                                [
                                    { key: "chamadas", label: "Chamadas" },
                                    { key: "turmas", label: "Turmas" },
                                ] as const
                            ).map((t) => {
                                const active = tab === t.key;
                                return (
                                    <Pressable
                                        key={t.key}
                                        accessibilityRole="tab"
                                        accessibilityState={{ selected: active }}
                                        onPress={() => setTab(t.key)}
                                        style={({ pressed }) => [
                                            styles.tab,
                                            active && styles.tabActive,
                                            pressed && !active && styles.tabPressed,
                                        ]}
                                    >
                                        <Text style={[styles.tabText, active && styles.tabTextActive]}>
                                            {t.label}
                                        </Text>
                                        {t.key === "turmas" && turmas.length > 0 ? (
                                            <Text style={[styles.tabCount, active && styles.tabCountActive]}>
                                                {turmas.length}
                                            </Text>
                                        ) : null}
                                    </Pressable>
                                );
                            })}
                        </View>
                    </View>

                    <View style={styles.topActions}>
                        <Button
                            title="UBS"
                            icon="business-outline"
                            variant="plain"
                            small
                            onPress={() => {
                                setUbsQuery("");
                                setUbsModal(true);
                            }}
                        />
                        <Button
                            title="Preceptores"
                            icon="person-outline"
                            variant="plain"
                            small
                            onPress={() => {
                                setPrecQuery("");
                                setPrecModal(true);
                            }}
                        />
                        <IconButton
                            icon="refresh-outline"
                            label="Atualizar"
                            color={colors.primary}
                            onPress={() => loadAll()}
                        />
                    </View>
                </View>

                {tab === "turmas" ? (
                    <FlatList
                        key={isWide ? "turmas-grid" : "turmas-list"}
                        data={loading ? [] : turmaSummaries}
                        keyExtractor={(t) => t.id}
                        numColumns={isWide ? 3 : 1}
                        columnWrapperStyle={isWide ? styles.turmaGridRow : undefined}
                        contentContainerStyle={styles.listContent}
                        refreshControl={
                            <RefreshControl refreshing={refreshing} onRefresh={() => loadAll(true)} />
                        }
                        ListHeaderComponent={
                            <View style={styles.turmasIntro}>
                                <Text style={styles.hint}>
                                    Cada turma reúne as chamadas de todos os seus grupos, em qualquer UBS
                                    ou hospital. Abra uma turma para lançar a presença de todos de uma vez.
                                </Text>
                                <Button
                                    title="Nova turma"
                                    icon="add"
                                    small
                                    onPress={() => setTurmaModal(true)}
                                />
                            </View>
                        }
                        renderItem={({ item: t }) => {
                            const pct = t.total ? Math.round((t.lastPresent / t.total) * 100) : 0;
                            return (
                                <Pressable
                                    accessibilityRole="button"
                                    accessibilityLabel={`Abrir turma ${t.name}`}
                                    onPress={() => openTurma(t.id)}
                                    style={({ pressed }) => [
                                        styles.turmaCard,
                                        isWide && styles.turmaCardWide,
                                        pressed && styles.callPressed,
                                    ]}
                                >
                                    <View style={styles.turmaTop}>
                                        <Text style={styles.turmaName} numberOfLines={1}>
                                            {t.name}
                                        </Text>
                                        <Ionicons name="chevron-forward" size={18} color={colors.muted} />
                                    </View>
                                    <Text style={styles.turmaStudents}>
                                        {t.total} aluno{t.total === 1 ? "" : "s"}
                                    </Text>

                                    {t.lastDate ? (
                                        <View style={styles.turmaLast}>
                                            <View style={styles.turmaLastRow}>
                                                <Text style={styles.turmaLastLabel}>
                                                    Última chamada:{" "}
                                                    {t.lastDate === todayISO()
                                                        ? "hoje"
                                                        : formatDateBR(t.lastDate)}
                                                </Text>
                                                <Text style={styles.turmaLastValue}>
                                                    {t.lastPresent}/{t.total}
                                                </Text>
                                            </View>
                                            <View
                                                style={styles.progressTrack}
                                                accessibilityLabel={`${t.lastPresent} de ${t.total} presentes`}
                                            >
                                                <View style={[styles.progressFill, { width: `${pct}%` }]} />
                                            </View>
                                        </View>
                                    ) : (
                                        <Text style={styles.turmaNone}>Nenhuma chamada ainda</Text>
                                    )}
                                </Pressable>
                            );
                        }}
                        ListEmptyComponent={
                            loading ? (
                                <View style={styles.skeletons}>
                                    {[0, 1].map((i) => (
                                        <View key={i} style={styles.skeletonCard}>
                                            <Skeleton height={20} width="20%" />
                                            <Skeleton height={12} width="50%" style={{ marginTop: spacing.sm }} />
                                        </View>
                                    ))}
                                </View>
                            ) : (
                                <EmptyState
                                    icon="people-outline"
                                    title="Nenhuma turma cadastrada"
                                    description="Cadastre a turma (ex.: T1) com o RA e o nome dos alunos para reunir as chamadas dos grupos."
                                >
                                    <Button
                                        title="Nova turma"
                                        icon="add"
                                        small
                                        onPress={() => setTurmaModal(true)}
                                    />
                                </EmptyState>
                            )
                        }
                    />
                ) : (
                    <>
                        {/* Barra de filtros: busca + período + local */}
                        <View style={[styles.toolbar, isWide && styles.toolbarWide]}>
                            <SearchBox
                                value={query}
                                onChangeText={setQuery}
                                placeholder="Buscar por UBS, data ou turno"
                                style={isWide ? { ...styles.toolbarSearch, flex: 1 } : styles.toolbarSearch}
                            />

                            {query.trim().length === 0 ? (
                                <View style={styles.segmented} accessibilityRole="radiogroup">
                                    {PERIODS.map((p) => {
                                        const active = period === p.key;
                                        return (
                                            <Pressable
                                                key={p.key}
                                                accessibilityRole="radio"
                                                accessibilityState={{ checked: active }}
                                                onPress={() => setPeriod(p.key)}
                                                style={[styles.segment, active && styles.segmentActive]}
                                            >
                                                <Text
                                                    numberOfLines={1}
                                                    style={[
                                                        styles.segmentText,
                                                        active && styles.segmentTextActive,
                                                    ]}
                                                >
                                                    {p.label}
                                                </Text>
                                            </Pressable>
                                        );
                                    })}
                                </View>
                            ) : (
                                <Text style={styles.resultCount}>
                                    {filteredRollcalls.length}{" "}
                                    {filteredRollcalls.length === 1 ? "resultado" : "resultados"} no histórico
                                </Text>
                            )}

                            {ubsOptions.length > 1 && (
                                <View style={[styles.localBox, !!ubsFilter && styles.localBoxActive]}>
                                    <Ionicons
                                        name="location-outline"
                                        size={16}
                                        color={ubsFilter ? colors.primary : colors.muted}
                                    />
                                    <Picker
                                        selectedValue={ubsFilter}
                                        onValueChange={(v) => setUbsFilter(String(v))}
                                        accessibilityLabel="Filtrar por local"
                                        style={styles.localPicker}
                                    >
                                        <Picker.Item label="Todos os locais" value="" />
                                        {ubsOptions.map((o) => (
                                            <Picker.Item key={o.key} label={o.name} value={o.key} />
                                        ))}
                                    </Picker>
                                </View>
                            )}
                        </View>

                        {loading ? (
                            <View style={styles.skeletons}>
                                {[0, 1, 2].map((i) => (
                                    <View key={i} style={styles.skeletonCard}>
                                        <Skeleton height={16} width="45%" />
                                        <Skeleton height={12} width="65%" style={{ marginTop: spacing.sm }} />
                                    </View>
                                ))}
                            </View>
                        ) : (
                            <FlatList
                                data={daySections}
                                keyExtractor={(s) => s.date}
                                contentContainerStyle={styles.listContent}
                                refreshControl={
                                    <RefreshControl refreshing={refreshing} onRefresh={() => loadAll(true)} />
                                }
                                renderItem={({ item: day }) => (
                                    <View style={styles.daySection}>
                                        <View style={styles.dayHeader}>
                                            <Text style={styles.dayTitle}>
                                                {dayName(day.date)}
                                                <Text style={styles.dayDate}>  {longDate(day.date)}</Text>
                                            </Text>
                                            <Text style={styles.dayTotals}>
                                                {day.groups.length} {day.groups.length === 1 ? "local" : "locais"},{" "}
                                                {day.students} aluno{day.students === 1 ? "" : "s"}
                                            </Text>
                                        </View>

                                        <View style={styles.panel}>
                                            {day.groups.map((group: any, index: number) => (
                                                <Pressable
                                                    key={group.key}
                                                    accessibilityRole="button"
                                                    accessibilityLabel={`Abrir chamadas de ${group.ubsName} em ${formatDateBR(group.date)}`}
                                                    onPress={() =>
                                                        group.items.length === 1
                                                            ? router.push(`/coordinator/${group.items[0].id}`)
                                                            : router.push({
                                                                  pathname: "/coordinator/group",
                                                                  params: {
                                                                      ids: group.items
                                                                          .map((i: any) => i.id)
                                                                          .join(","),
                                                                  },
                                                              })
                                                    }
                                                    style={({ pressed }) => [
                                                        styles.callRow,
                                                        index > 0 && styles.callDivider,
                                                        pressed && styles.callPressed,
                                                    ]}
                                                >
                                                    <View
                                                        style={[
                                                            styles.turnoStrip,
                                                            group.turno === "tarde"
                                                                ? styles.turnoStripTarde
                                                                : group.turno === "manha"
                                                                  ? styles.turnoStripManha
                                                                  : null,
                                                        ]}
                                                    />
                                                    <View style={[styles.callMain, isWide && styles.callMainWide]}>
                                                        <View style={styles.callPlace}>
                                                            <Text style={styles.callTitle} numberOfLines={1}>
                                                                {group.ubsName}
                                                            </Text>
                                                            {group.turno ? (
                                                                <TurnoTag turno={group.turno} />
                                                            ) : null}
                                                        </View>
                                                        <View style={styles.aulas}>
                                                            {group.items.map((it: any) => (
                                                                <View key={it.id} style={styles.aulaPill}>
                                                                    <Text style={styles.aulaPillLabel}>
                                                                        {shiftLabel(it.shift)}
                                                                    </Text>
                                                                    <Text style={styles.aulaPillValue}>
                                                                        {(it.ras || []).length}
                                                                    </Text>
                                                                </View>
                                                            ))}
                                                        </View>
                                                    </View>
                                                    <Ionicons
                                                        name="chevron-forward"
                                                        size={18}
                                                        color={colors.muted}
                                                    />
                                                </Pressable>
                                            ))}
                                        </View>
                                    </View>
                                )}
                                ListEmptyComponent={
                                    query.trim().length > 0 ? (
                                        <EmptyState
                                            icon="search-outline"
                                            title="Nada encontrado"
                                            description={`Nenhuma chamada corresponde a "${query.trim()}".`}
                                        />
                                    ) : period !== "all" ? (
                                        <EmptyState
                                            icon="today-outline"
                                            title={
                                                (period === "today"
                                                    ? "Nenhuma chamada hoje"
                                                    : "Nenhuma chamada nos últimos 7 dias") +
                                                (ubsFilter ? " neste local" : "")
                                            }
                                            description="As chamadas aparecem aqui assim que os preceptores salvarem."
                                        >
                                            <Button
                                                title="Ver todas as chamadas"
                                                variant="secondary"
                                                small
                                                onPress={() => setPeriod("all")}
                                            />
                                        </EmptyState>
                                    ) : (
                                        <EmptyState
                                            icon="clipboard-outline"
                                            title="Nenhuma chamada recebida"
                                            description="As chamadas salvas pelos preceptores aparecem aqui."
                                        />
                                    )
                                }
                            />
                        )}
                    </>
                )}

                {/* MODAL TURMA */}
                <AppModal
                    visible={turmaModal}
                    onClose={() => setTurmaModal(false)}
                    title="Nova turma"
                    footer={
                        <>
                            <Button title="Fechar" variant="plain" onPress={() => setTurmaModal(false)} />
                            <Button title="Salvar" loading={turmaSaving} onPress={handleCreateTurma} />
                        </>
                    }
                >
                    <Field
                        label="Nome da turma"
                        placeholder="Ex.: T1"
                        value={turmaName}
                        onChangeText={(v) => {
                            setTurmaName(v);
                            if (turmaError) setTurmaError(null);
                        }}
                        containerStyle={styles.fieldGap}
                    />
                    <Field
                        label="Alunos (RA e nome)"
                        placeholder={"Cole do Excel, um aluno por linha:\n12345;Maria da Silva\n12346;João Souza"}
                        multiline
                        value={turmaText}
                        error={turmaError}
                        onChangeText={(v) => {
                            setTurmaText(v);
                            if (turmaError) setTurmaError(null);
                        }}
                        style={styles.textArea}
                    />
                    <View style={styles.importRow}>
                        {Platform.OS === "web" ? (
                            <Button
                                title="Importar arquivo CSV"
                                icon="document-attach-outline"
                                variant="secondary"
                                small
                                onPress={handlePickAlunosFile}
                            />
                        ) : null}
                        {turmaText.trim() ? (
                            <Text style={styles.importInfo}>
                                {turmaPreview.alunos.length} aluno
                                {turmaPreview.alunos.length === 1 ? "" : "s"} reconhecido
                                {turmaPreview.alunos.length === 1 ? "" : "s"}
                                {turmaPreview.ignored
                                    ? ` · ${turmaPreview.ignored} linha${turmaPreview.ignored === 1 ? "" : "s"} sem RA ignorada${turmaPreview.ignored === 1 ? "" : "s"}`
                                    : ""}
                            </Text>
                        ) : null}
                    </View>
                </AppModal>

                {/* MODAL UBS */}
                <AppModal
                    visible={ubsModal}
                    onClose={() => setUbsModal(false)}
                    title="Cadastrar UBS"
                    footer={
                        <>
                            <Button title="Fechar" variant="plain" onPress={() => setUbsModal(false)} />
                            <Button title="Salvar" loading={ubsSaving} onPress={handleCreateUbs} />
                        </>
                    }
                >
                    <Field
                        label="Nome da UBS"
                        placeholder="Ex.: UBS Central"
                        value={ubsName}
                        error={ubsError}
                        onChangeText={(v) => {
                            setUbsName(v);
                            if (ubsError) setUbsError(null);
                        }}
                        onSubmitEditing={handleCreateUbs}
                    />

                    <Text style={styles.modalSubtitle}>
                        UBS cadastradas ({ubsList.length})
                    </Text>
                    {ubsList.length > 0 && (
                        <SearchBox
                            value={ubsQuery}
                            onChangeText={setUbsQuery}
                            placeholder="Buscar UBS..."
                            style={styles.modalSearch}
                        />
                    )}
                    <ScrollView style={styles.modalList} nestedScrollEnabled>
                        {ubsList.length === 0 ? (
                            <Text style={styles.modalEmpty}>Nenhuma UBS cadastrada.</Text>
                        ) : filteredUbs.length === 0 ? (
                            <Text style={styles.modalEmpty}>
                                Nenhuma UBS encontrada para “{ubsQuery.trim()}”.
                            </Text>
                        ) : (
                            filteredUbs.map((item, index) => (
                                <View
                                    key={item.id}
                                    style={[styles.row, index === filteredUbs.length - 1 && styles.rowLast]}
                                >
                                    <Text style={styles.rowText}>{item.name}</Text>
                                    <IconButton
                                        icon="trash-outline"
                                        label={`Excluir UBS ${item.name}`}
                                        color={colors.danger}
                                        onPress={() => handleDeleteUbs(item.id, item.name)}
                                    />
                                </View>
                            ))
                        )}
                    </ScrollView>
                </AppModal>

                {/* MODAL PRECEPTOR */}
                <AppModal
                    visible={precModal}
                    onClose={() => setPrecModal(false)}
                    title="Cadastrar preceptor"
                    footer={
                        <>
                            <Button title="Fechar" variant="plain" onPress={() => setPrecModal(false)} />
                            <Button title="Salvar" loading={precSaving} onPress={handleCreatePreceptor} />
                        </>
                    }
                >
                    <Field
                        label="Nome"
                        placeholder="Nome completo"
                        value={precName}
                        onChangeText={(v) => {
                            setPrecName(v);
                            if (precError) setPrecError(null);
                        }}
                        containerStyle={styles.fieldGap}
                    />
                    <Field
                        label="E-mail"
                        placeholder="email@exemplo.com"
                        autoCapitalize="none"
                        keyboardType="email-address"
                        value={precEmail}
                        onChangeText={(v) => {
                            setPrecEmail(v);
                            if (precError) setPrecError(null);
                        }}
                        containerStyle={styles.fieldGap}
                    />
                    <Field
                        label="Senha"
                        placeholder="Mínimo de 6 caracteres"
                        secureTextEntry
                        value={precPass}
                        error={precError}
                        onChangeText={(v) => {
                            setPrecPass(v);
                            if (precError) setPrecError(null);
                        }}
                        containerStyle={styles.fieldGap}
                    />

                    <Text style={styles.modalSubtitle}>
                        Preceptores cadastrados ({preceptors.length})
                    </Text>
                    {preceptors.length > 0 && (
                        <SearchBox
                            value={precQuery}
                            onChangeText={setPrecQuery}
                            placeholder="Buscar por nome ou e-mail..."
                            style={styles.modalSearch}
                        />
                    )}
                    <ScrollView style={styles.modalList} nestedScrollEnabled>
                        {preceptors.length === 0 ? (
                            <Text style={styles.modalEmpty}>Nenhum preceptor cadastrado.</Text>
                        ) : filteredPreceptors.length === 0 ? (
                            <Text style={styles.modalEmpty}>
                                Nenhum preceptor encontrado para “{precQuery.trim()}”.
                            </Text>
                        ) : (
                            filteredPreceptors.map((item, index) => (
                                <View
                                    key={item.id}
                                    style={[
                                        styles.row,
                                        index === filteredPreceptors.length - 1 && styles.rowLast,
                                    ]}
                                >
                                    <View style={styles.rowInfo}>
                                        <Text style={styles.rowText}>{item.name}</Text>
                                        <Text style={styles.rowSub}>{item.email}</Text>
                                    </View>
                                    <IconButton
                                        icon="trash-outline"
                                        label={`Excluir preceptor ${item.name}`}
                                        color={colors.danger}
                                        onPress={() => handleDeletePreceptor(item.id, item.name)}
                                    />
                                </View>
                            ))
                        )}
                    </ScrollView>
                </AppModal>
            </View>
        </ScreenContainer>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    containerWide: { maxWidth: 1040, alignSelf: "center", width: "100%" },

    // Cabeçalho da página
    pageHeader: {
        flexDirection: "row",
        flexWrap: "wrap",
        alignItems: "flex-end",
        justifyContent: "space-between",
        gap: spacing.sm,
        marginTop: spacing.xs,
        marginBottom: spacing.lg,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
    },
    pageHeaderMain: {
        gap: spacing.xs,
    },
    todayText: {
        ...type.meta,
        fontSize: 14,
    },
    tabs: {
        flexDirection: "row",
        gap: spacing.lg,
    },
    tab: {
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.sm,
        paddingTop: spacing.xs,
        paddingBottom: spacing.sm + 2,
        borderBottomWidth: 3,
        borderBottomColor: "transparent",
        marginBottom: -1,
    },
    tabActive: {
        borderBottomColor: colors.primary,
    },
    tabPressed: {
        opacity: 0.7,
    },
    tabText: {
        fontSize: 22,
        fontWeight: "700",
        letterSpacing: -0.3,
        color: colors.muted,
    },
    tabTextActive: {
        color: colors.ink,
    },
    tabCount: {
        fontSize: 13,
        fontWeight: "700",
        color: colors.muted,
        backgroundColor: colors.divider,
        borderRadius: radius.pill,
        paddingHorizontal: 8,
        paddingVertical: 1,
        overflow: "hidden",
    },
    tabCountActive: {
        color: colors.primary,
        backgroundColor: colors.primaryTint,
    },
    topActions: {
        flexDirection: "row",
        alignItems: "center",
        paddingBottom: spacing.sm,
    },

    // Barra de filtros
    toolbar: {
        gap: spacing.sm,
        padding: spacing.sm,
        marginBottom: spacing.xl,
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: radius.md,
        ...shadow,
    },
    toolbarWide: {
        flexDirection: "row",
        alignItems: "center",
    },
    toolbarSearch: {
        borderWidth: 0,
        backgroundColor: colors.bg,
        minHeight: 40,
    },
    segmented: {
        flexDirection: "row",
        flexShrink: 0,
        padding: 3,
        borderRadius: radius.sm + 2,
        backgroundColor: colors.bg,
    },
    segment: {
        flexGrow: 1,
        minHeight: 34,
        paddingHorizontal: spacing.md,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: radius.sm,
    },
    segmentActive: {
        backgroundColor: colors.surface,
        ...(Platform.OS === "web"
            ? ({ boxShadow: "0 1px 2px rgba(15, 23, 42, 0.12)" } as object)
            : { elevation: 1 }),
    },
    segmentText: {
        fontSize: 13,
        fontWeight: "600",
        color: colors.muted,
    },
    segmentTextActive: {
        color: colors.ink,
    },
    resultCount: {
        ...type.meta,
        paddingHorizontal: spacing.sm,
    },
    localBox: {
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.xs,
        minHeight: 40,
        minWidth: 220,
        paddingLeft: spacing.md,
        borderRadius: radius.sm + 2,
        backgroundColor: colors.bg,
        overflow: "hidden",
    },
    localBoxActive: {
        backgroundColor: colors.primaryTint,
    },
    localPicker: {
        flex: 1,
        minHeight: 40,
        borderWidth: 0,
        backgroundColor: "transparent",
        color: colors.ink,
        fontSize: 13,
        fontWeight: "600",
        paddingRight: spacing.sm,
        ...(Platform.OS === "web" ? ({ outlineStyle: "none", cursor: "pointer" } as object) : null),
    },

    listContent: {
        paddingBottom: spacing.xxl,
    },

    // Livro de chamadas: um bloco por dia
    daySection: {
        marginBottom: spacing.xl,
    },
    dayHeader: {
        flexDirection: "row",
        flexWrap: "wrap",
        alignItems: "baseline",
        justifyContent: "space-between",
        gap: spacing.sm,
        marginBottom: spacing.sm,
        paddingHorizontal: spacing.xs,
    },
    dayTitle: {
        fontSize: 16,
        fontWeight: "700",
        color: colors.ink,
    },
    dayDate: {
        fontSize: 14,
        fontWeight: "400",
        color: colors.muted,
    },
    dayTotals: {
        ...type.meta,
        fontVariant: ["tabular-nums"],
    },
    panel: {
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: radius.md,
        overflow: "hidden",
        ...shadow,
    },
    callRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.md,
        minHeight: 64,
        paddingVertical: spacing.md,
        paddingLeft: spacing.lg + 4,
        paddingRight: spacing.md,
        backgroundColor: colors.surface,
    },
    callDivider: {
        borderTopWidth: 1,
        borderTopColor: colors.divider,
    },
    callPressed: {
        backgroundColor: colors.bg,
    },
    // Faixa do turno na borda esquerda: identifica manhã/tarde de relance
    turnoStrip: {
        position: "absolute",
        left: 0,
        top: 0,
        bottom: 0,
        width: 4,
        backgroundColor: colors.border,
    },
    turnoStripManha: {
        backgroundColor: "#8FB3D1",
    },
    turnoStripTarde: {
        backgroundColor: colors.primary,
    },
    callMain: {
        flex: 1,
        gap: spacing.sm,
    },
    callMainWide: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
    },
    callPlace: {
        flexShrink: 1,
        flexDirection: "row",
        flexWrap: "wrap",
        alignItems: "center",
        gap: spacing.sm,
    },
    callTitle: {
        ...type.itemTitle,
        flexShrink: 1,
    },
    aulas: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: spacing.sm,
    },
    aulaPill: {
        flexDirection: "row",
        alignItems: "center",
        borderRadius: radius.sm,
        borderWidth: 1,
        borderColor: colors.border,
        overflow: "hidden",
    },
    aulaPillLabel: {
        fontSize: 12,
        fontWeight: "600",
        color: colors.muted,
        paddingHorizontal: spacing.sm,
        paddingVertical: 3,
    },
    aulaPillValue: {
        minWidth: 28,
        textAlign: "center",
        fontSize: 13,
        fontWeight: "700",
        color: colors.primary,
        backgroundColor: colors.primaryTint,
        paddingHorizontal: spacing.sm,
        paddingVertical: 3,
        fontVariant: ["tabular-nums"],
    },

    // Turmas
    turmasIntro: {
        flexDirection: "row",
        flexWrap: "wrap",
        alignItems: "center",
        justifyContent: "space-between",
        gap: spacing.md,
        marginBottom: spacing.lg,
    },
    hint: {
        ...type.body,
        fontSize: 14,
        color: colors.muted,
        flex: 1,
        minWidth: 240,
        maxWidth: 620,
    },
    turmaGridRow: {
        gap: spacing.md,
    },
    turmaCard: {
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: radius.md,
        padding: spacing.lg,
        marginBottom: spacing.md,
        ...shadow,
    },
    turmaCardWide: {
        flex: 1,
        maxWidth: "33.333%",
    },
    turmaTop: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
    },
    turmaName: {
        fontSize: 26,
        fontWeight: "800",
        letterSpacing: -0.5,
        color: colors.primary,
        flexShrink: 1,
    },
    turmaStudents: {
        ...type.meta,
        fontSize: 14,
        marginTop: 2,
    },
    turmaLast: {
        marginTop: spacing.lg,
        gap: spacing.xs + 2,
    },
    turmaLastRow: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "baseline",
    },
    turmaLastLabel: {
        ...type.meta,
    },
    turmaLastValue: {
        fontSize: 14,
        fontWeight: "700",
        color: colors.ink,
        fontVariant: ["tabular-nums"],
    },
    progressTrack: {
        height: 6,
        borderRadius: radius.pill,
        backgroundColor: colors.divider,
        overflow: "hidden",
    },
    progressFill: {
        height: "100%",
        borderRadius: radius.pill,
        backgroundColor: colors.success,
    },
    turmaNone: {
        ...type.meta,
        marginTop: spacing.lg,
        fontStyle: "italic",
    },

    skeletons: { gap: spacing.sm },
    skeletonCard: {
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: radius.md,
        padding: spacing.lg,
    },

    // Modais
    textArea: {
        minHeight: 140,
        textAlignVertical: "top",
    },
    importRow: {
        flexDirection: "row",
        flexWrap: "wrap",
        alignItems: "center",
        gap: spacing.sm,
        marginTop: spacing.sm,
    },
    importInfo: {
        ...type.meta,
    },
    modalSearch: {
        marginBottom: spacing.sm,
    },
    modalSubtitle: {
        ...type.label,
        marginTop: spacing.xl,
        marginBottom: spacing.sm,
    },
    modalList: {
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: radius.md,
        maxHeight: 260,
    },
    modalEmpty: {
        ...type.meta,
        padding: spacing.lg,
    },
    row: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        paddingVertical: spacing.sm,
        paddingLeft: spacing.lg,
        paddingRight: spacing.sm,
        borderBottomWidth: 1,
        borderBottomColor: colors.divider,
    },
    rowLast: {
        borderBottomWidth: 0,
    },
    rowInfo: { flex: 1 },
    rowText: {
        ...type.itemTitle,
    },
    rowSub: {
        ...type.meta,
        marginTop: 2,
    },
    fieldGap: {
        marginBottom: spacing.lg,
    },
});
