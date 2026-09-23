import { Ionicons } from "@expo/vector-icons";
import { Picker } from "@react-native-picker/picker";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";

import { listRollcalls } from "../../src/components/services/rollcalls";
import { deleteTurma, getTurma, updateTurmaAlunos } from "../../src/components/services/turmas";
import { AppModal } from "../../src/components/ui/AppModal";
import { Button } from "../../src/components/ui/Button";
import { EmptyState } from "../../src/components/ui/EmptyState";
import { Field } from "../../src/components/ui/Field";
import { IconButton } from "../../src/components/ui/IconButton";
import { ScreenContainer } from "../../src/components/ui/ScreenContainer";
import { Skeleton } from "../../src/components/ui/Skeleton";
import { TurnoTag } from "../../src/components/ui/TurnoTag";
import { confirmAction, notify } from "../../src/components/ui/feedback";
import { colors, radius, shadow, spacing, type } from "../../src/components/ui/theme";
import {
  Aluno,
  mergeAlunos,
  normalizeRa,
  parseAlunos,
  pickTextFileWeb,
} from "../../src/components/utils/alunosImport";
import { dayName, longDate } from "../../src/components/utils/dates";
import { shiftLabel, todayISO } from "../../src/components/utils/format";

/** Aula normalizada (chamadas antigas: "manha" -> 1ª, "tarde" -> 2ª), igual ao envio pro Edubox. */
function aulaKey(shift: string): "aula1" | "aula2" {
  const s = String(shift || "").toLowerCase();
  return s === "aula2" || s === "tarde" ? "aula2" : "aula1";
}

/**
 * Chamadas da turma: junta as chamadas de todos os grupos (qualquer UBS/hospital)
 * que têm alunos desta turma, por dia e aula, e lança tudo de uma vez no Edubox.
 */
export default function TurmaScreen() {
  const { turmaId } = useLocalSearchParams<{ turmaId: string }>();
  const { width } = useWindowDimensions();
  const isWide = width >= 900;

  const [turma, setTurma] = useState<any>(null);
  const [rollcalls, setRollcalls] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [date, setDate] = useState("");
  const [aula, setAula] = useState<"aula1" | "aula2">("aula1");
  const [listMode, setListMode] = useState<"presentes" | "ausentes">("presentes");

  const [addOpen, setAddOpen] = useState(false);
  const [addText, setAddText] = useState("");
  const [addSaving, setAddSaving] = useState(false);
  const addPreview = useMemo(() => parseAlunos(addText), [addText]);

  const load = useCallback(async () => {
    const [t, calls] = await Promise.all([getTurma(String(turmaId)), listRollcalls()]);
    setTurma(t);
    setRollcalls(calls);
  }, [turmaId]);

  // Recarrega ao voltar para a tela (pode ter chegado chamada nova)
  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        try {
          setLoading(true);
          await load();
        } catch (e: any) {
          if (active) notify("error", e?.message || "Falha ao carregar a turma.");
        } finally {
          if (active) setLoading(false);
        }
      })();
      return () => {
        active = false;
      };
    }, [load])
  );

  const alunos: Aluno[] = useMemo(() => turma?.alunos || [], [turma]);
  const nomePorRa = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of alunos) m.set(normalizeRa(a.ra), a.nome);
    return m;
  }, [alunos]);

  // Chamadas (de qualquer grupo) que têm pelo menos um aluno desta turma
  const turmaCalls = useMemo(
    () =>
      rollcalls
        .map((r) => ({
          ...r,
          turmaRas: Array.from(
            new Set((r.ras || []).map(normalizeRa).filter((ra: string) => nomePorRa.has(ra)))
          ) as string[],
        }))
        .filter((r) => r.turmaRas.length > 0),
    [rollcalls, nomePorRa]
  );

  const dates = useMemo(
    () =>
      Array.from(new Set(turmaCalls.map((r) => String(r.date || "")).filter(Boolean))).sort((a, b) =>
        a < b ? 1 : -1
      ),
    [turmaCalls]
  );

  // Dia padrão: hoje (se tiver chamada), senão o mais recente
  useEffect(() => {
    if (!dates.length || dates.includes(date)) return;
    const today = todayISO();
    setDate(dates.includes(today) ? today : dates[0]);
  }, [dates, date]);

  const ofDay = useMemo(() => turmaCalls.filter((r) => String(r.date) === date), [turmaCalls, date]);

  const aulasOfDay = useMemo(
    () => (["aula1", "aula2"] as const).filter((a) => ofDay.some((r) => aulaKey(r.shift) === a)),
    [ofDay]
  );

  useEffect(() => {
    if (aulasOfDay.length && !aulasOfDay.includes(aula)) setAula(aulasOfDay[0]);
  }, [aulasOfDay, aula]);

  const groups = useMemo(
    () =>
      ofDay
        .filter((r) => aulaKey(r.shift) === aula)
        .sort(
          (a, b) =>
            String(a.ubsName).localeCompare(String(b.ubsName)) ||
            String(a.turno || "").localeCompare(String(b.turno || ""))
        ),
    [ofDay, aula]
  );

  const presentes = useMemo(() => {
    const set = new Set(groups.flatMap((g) => g.turmaRas));
    return alunos
      .filter((a) => set.has(normalizeRa(a.ra)))
      .sort((a, b) => a.nome.localeCompare(b.nome));
  }, [groups, alunos]);
  const presentSet = useMemo(() => new Set(presentes.map((a) => normalizeRa(a.ra))), [presentes]);
  const ausentes = useMemo(
    () =>
      alunos
        .filter((a) => !presentSet.has(normalizeRa(a.ra)))
        .sort((a, b) => a.nome.localeCompare(b.nome)),
    [alunos, presentSet]
  );

  const pct = alunos.length ? Math.round((presentes.length / alunos.length) * 100) : 0;
  const shownList = listMode === "presentes" ? presentes : ausentes;

  function send() {
    if (!groups.length) return;
    router.push({
      pathname: "/coordinator/import-edubox",
      params: { id: groups.map((g) => g.id).join(","), turmaId: String(turmaId) },
    });
  }

  async function pickFile() {
    const text = await pickTextFileWeb();
    if (text != null) setAddText(text);
  }

  async function removeTurma() {
    const ok = await confirmAction({
      title: "Excluir turma",
      message: `Tem certeza que deseja excluir a turma "${turma.name}"? As chamadas não são apagadas.`,
      confirmLabel: "Excluir",
      destructive: true,
    });
    if (!ok) return;
    try {
      await deleteTurma(turma.id);
      notify("success", "Turma excluída.");
      router.back();
    } catch (e: any) {
      notify("error", e?.message || "Falha ao excluir a turma.");
    }
  }

  async function saveNewAlunos() {
    if (!addPreview.alunos.length) {
      notify("error", "Nenhum aluno reconhecido. Use uma linha por aluno com RA e nome.");
      return;
    }
    try {
      setAddSaving(true);
      const merged = mergeAlunos(alunos, addPreview.alunos);
      await updateTurmaAlunos(turma.id, merged);
      const novos = merged.length - alunos.length;
      notify(
        "success",
        novos > 0
          ? `${novos} aluno${novos === 1 ? "" : "s"} adicionado${novos === 1 ? "" : "s"}.`
          : "Lista atualizada."
      );
      setAddText("");
      setAddOpen(false);
      await load();
    } catch (e: any) {
      notify("error", e?.message || "Falha ao salvar os alunos.");
    } finally {
      setAddSaving(false);
    }
  }

  if (loading) {
    return (
      <ScreenContainer scrollable={false}>
        <View style={[styles.content, isWide && styles.contentWide]}>
          <Skeleton height={14} width="12%" />
          <Skeleton height={34} width="20%" style={{ marginTop: spacing.sm }} />
          <Skeleton height={160} style={{ marginTop: spacing.xl }} />
          <Skeleton height={240} style={{ marginTop: spacing.lg }} />
        </View>
      </ScreenContainer>
    );
  }

  if (!turma) {
    return (
      <ScreenContainer scrollable={false} contentContainerStyle={{ justifyContent: "center" }}>
        <EmptyState icon="people-outline" title="Turma não encontrada" description="Ela pode ter sido excluída.">
          <Button title="Voltar para a lista" variant="secondary" small onPress={() => router.back()} />
        </EmptyState>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer scrollable contentContainerStyle={styles.scroll}>
      <View style={[styles.content, isWide && styles.contentWide]}>
        {/* Cabeçalho: nome da turma + ações de cadastro, discretas */}
        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text style={styles.kicker}>Turma</Text>
            <Text style={styles.turmaName}>{turma.name}</Text>
            <Text style={styles.headerMeta}>
              {alunos.length} aluno{alunos.length === 1 ? "" : "s"} cadastrado
              {alunos.length === 1 ? "" : "s"}
            </Text>
          </View>
          <View style={styles.headerActions}>
            <Button
              title="Adicionar alunos"
              icon="person-add-outline"
              variant="plain"
              small
              onPress={() => setAddOpen(true)}
            />
            <IconButton
              icon="trash-outline"
              label="Excluir turma"
              color={colors.danger}
              onPress={removeTurma}
            />
          </View>
        </View>

        {!dates.length ? (
          <View style={[styles.panel, styles.emptyPanel]}>
            <EmptyState
              icon="clipboard-outline"
              title="Nenhuma chamada desta turma ainda"
              description="Assim que um grupo com alunos desta turma fizer a chamada, ela aparece aqui, junto com as dos outros grupos."
            />
          </View>
        ) : (
          <>
            {/* Seleção de dia e aula */}
            <View style={[styles.toolbar, !isWide && styles.toolbarStack]}>
              <View style={[styles.selectBox, isWide && styles.selectBoxWide]}>
                <Ionicons name="calendar-outline" size={16} color={colors.primary} />
                <Picker
                  selectedValue={date}
                  onValueChange={(v) => setDate(String(v))}
                  accessibilityLabel="Escolher o dia"
                  style={styles.picker}
                >
                  {dates.map((d) => (
                    <Picker.Item key={d} label={`${dayName(d)}, ${longDate(d)}`} value={d} />
                  ))}
                </Picker>
              </View>

              <View style={styles.segmented} accessibilityRole="radiogroup">
                {(["aula1", "aula2"] as const).map((a) => {
                  const active = a === aula;
                  const available = aulasOfDay.includes(a);
                  return (
                    <Pressable
                      key={a}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: active, disabled: !available }}
                      disabled={!available}
                      onPress={() => setAula(a)}
                      style={[
                        styles.segment,
                        active && styles.segmentActive,
                        !available && styles.segmentDisabled,
                      ]}
                    >
                      <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
                        {shiftLabel(a)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            {/* Resumo da presença + lançamento */}
            <View style={[styles.panel, styles.summary, isWide && styles.summaryWide]}>
              <View style={styles.summaryStats}>
                <View style={styles.summaryNumberRow}>
                  <Text style={styles.summaryNumber}>{presentes.length}</Text>
                  <Text style={styles.summaryOf}>de {alunos.length} presentes</Text>
                </View>
                <View
                  style={styles.progressTrack}
                  accessibilityLabel={`${pct}% da turma presente`}
                >
                  <View style={[styles.progressFill, { width: `${pct}%` }]} />
                </View>
                <Text style={styles.summaryMeta}>
                  {pct}% da turma · {ausentes.length} ausente{ausentes.length === 1 ? "" : "s"} ·{" "}
                  {groups.length} grupo{groups.length === 1 ? "" : "s"}
                </Text>
              </View>

              <View style={[styles.summaryAction, isWide && styles.summaryActionWide]}>
                <Button
                  title="Lançar no Edubox"
                  icon="qr-code-outline"
                  disabled={!groups.length}
                  onPress={send}
                />
                <Text style={styles.summaryHelp}>
                  Envia de uma vez os {presentes.length} presentes da {shiftLabel(aula)} de{" "}
                  {dayName(date).toLowerCase() === "hoje" ? "hoje" : longDate(date)}.
                </Text>
              </View>
            </View>

            <View style={[styles.columns, isWide && styles.columnsWide]}>
              {/* Alunos: presentes / ausentes */}
              <View style={[styles.panel, isWide && styles.colMain]}>
                <View style={styles.panelHeader}>
                  <Text style={styles.panelTitle}>Alunos</Text>
                  <View style={styles.segmentedSmall} accessibilityRole="radiogroup">
                    {(
                      [
                        { key: "presentes", label: `Presentes ${presentes.length}` },
                        { key: "ausentes", label: `Ausentes ${ausentes.length}` },
                      ] as const
                    ).map((m) => {
                      const active = listMode === m.key;
                      return (
                        <Pressable
                          key={m.key}
                          accessibilityRole="radio"
                          accessibilityState={{ checked: active }}
                          onPress={() => setListMode(m.key)}
                          style={[styles.segmentSm, active && styles.segmentActive]}
                        >
                          <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
                            {m.label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>

                {shownList.length === 0 ? (
                  <Text style={styles.emptyText}>
                    {listMode === "presentes"
                      ? "Nenhum aluno desta turma nesta aula."
                      : "Todos os alunos da turma estão presentes."}
                  </Text>
                ) : (
                  shownList.map((a, index) => {
                    const presente = listMode === "presentes";
                    return (
                      <View
                        key={a.ra}
                        style={[styles.studentRow, index === shownList.length - 1 && styles.rowLast]}
                      >
                        <Ionicons
                          name={presente ? "checkmark-circle" : "ellipse-outline"}
                          size={18}
                          color={presente ? colors.success : colors.border}
                        />
                        <Text
                          style={[styles.studentName, !presente && styles.studentNameOff]}
                          numberOfLines={1}
                        >
                          {a.nome || "Sem nome"}
                        </Text>
                        <Text style={styles.studentRa}>{a.ra}</Text>
                      </View>
                    );
                  })
                )}
              </View>

              {/* Grupos (UBS/hospitais) que fizeram a chamada */}
              <View style={[styles.panel, isWide && styles.colSide]}>
                <View style={styles.panelHeader}>
                  <Text style={styles.panelTitle}>Grupos</Text>
                  <Text style={styles.panelCount}>{groups.length}</Text>
                </View>
                {groups.map((g) => (
                  <Pressable
                    key={g.id}
                    accessibilityRole="button"
                    accessibilityLabel={`Abrir chamada de ${g.ubsName}`}
                    onPress={() => router.push(`/coordinator/${g.id}`)}
                    style={({ pressed }) => [styles.groupRow, pressed && styles.rowPressed]}
                  >
                    <View
                      style={[
                        styles.turnoStrip,
                        g.turno === "tarde"
                          ? styles.turnoStripTarde
                          : g.turno === "manha"
                            ? styles.turnoStripManha
                            : null,
                      ]}
                    />
                    <View style={styles.groupInfo}>
                      <Text style={styles.groupName} numberOfLines={2}>
                        {g.ubsName}
                      </Text>
                      {g.turno ? <TurnoTag turno={g.turno} /> : null}
                    </View>
                    <Text style={styles.groupCount}>{g.turmaRas.length}</Text>
                    <Ionicons name="chevron-forward" size={16} color={colors.muted} />
                  </Pressable>
                ))}
                <Text style={styles.groupsFoot}>
                  Números = alunos desta turma em cada grupo. Toque para ver ou corrigir a chamada.
                </Text>
              </View>
            </View>
          </>
        )}
      </View>

      {/* Adicionar alunos */}
      <AppModal
        visible={addOpen}
        onClose={() => setAddOpen(false)}
        title={`Adicionar alunos à turma ${turma.name}`}
        footer={
          <>
            <Button title="Cancelar" variant="plain" onPress={() => setAddOpen(false)} />
            <Button title="Salvar alunos" loading={addSaving} onPress={saveNewAlunos} />
          </>
        }
      >
        <Field
          label="Alunos (RA e nome)"
          placeholder={"Cole do Excel, um aluno por linha:\n12345;Maria da Silva"}
          multiline
          value={addText}
          onChangeText={setAddText}
          style={styles.textArea}
        />
        <View style={styles.addRow}>
          {Platform.OS === "web" ? (
            <Button
              title="Importar arquivo CSV"
              icon="document-attach-outline"
              variant="secondary"
              small
              onPress={pickFile}
            />
          ) : null}
          {addText.trim() ? (
            <Text style={styles.addInfo}>
              {addPreview.alunos.length} aluno{addPreview.alunos.length === 1 ? "" : "s"} reconhecido
              {addPreview.alunos.length === 1 ? "" : "s"}
            </Text>
          ) : null}
        </View>
        <Text style={styles.addHint}>
          Alunos que já estão na turma não são duplicados; se o RA já existir, o nome é atualizado.
        </Text>
      </AppModal>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingBottom: spacing.xxl },
  content: { width: "100%" },
  contentWide: { maxWidth: 1040, alignSelf: "center" },

  // Cabeçalho
  header: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: spacing.md,
    marginTop: spacing.xs,
    marginBottom: spacing.xl,
  },
  headerText: { gap: 2 },
  kicker: {
    ...type.meta,
    fontSize: 14,
  },
  turmaName: {
    fontSize: 34,
    fontWeight: "800",
    letterSpacing: -0.8,
    color: colors.primary,
  },
  headerMeta: {
    ...type.meta,
    fontSize: 14,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },

  // Seleção de dia e aula
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.sm,
    marginBottom: spacing.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    ...shadow,
  },
  toolbarStack: {
    flexDirection: "column",
    alignItems: "stretch",
  },
  selectBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    minHeight: 40,
    paddingLeft: spacing.md,
    borderRadius: radius.sm + 2,
    backgroundColor: colors.bg,
    overflow: "hidden",
  },
  selectBoxWide: {
    flex: 1,
  },
  picker: {
    flex: 1,
    minHeight: 40,
    borderWidth: 0,
    backgroundColor: "transparent",
    color: colors.ink,
    fontSize: 14,
    fontWeight: "600",
    paddingRight: spacing.sm,
    ...(Platform.OS === "web" ? ({ outlineStyle: "none", cursor: "pointer" } as object) : null),
  },
  segmented: {
    flexDirection: "row",
    flexShrink: 0,
    padding: 3,
    borderRadius: radius.sm + 2,
    backgroundColor: colors.bg,
  },
  segmentedSmall: {
    flexDirection: "row",
    padding: 3,
    borderRadius: radius.sm + 2,
    backgroundColor: colors.bg,
  },
  segment: {
    flexGrow: 1,
    minHeight: 34,
    paddingHorizontal: spacing.lg,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
  },
  segmentSm: {
    minHeight: 30,
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
  segmentDisabled: {
    opacity: 0.4,
  },
  segmentText: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.muted,
  },
  segmentTextActive: {
    color: colors.ink,
  },

  // Painéis
  panel: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    overflow: "hidden",
    ...shadow,
  },
  emptyPanel: {
    paddingVertical: spacing.xl,
  },
  panelHeader: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  panelTitle: {
    ...type.sectionTitle,
  },
  panelCount: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.muted,
    backgroundColor: colors.divider,
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 1,
    overflow: "hidden",
  },

  // Resumo
  summary: {
    padding: spacing.xl,
    gap: spacing.xl,
    marginBottom: spacing.lg,
  },
  summaryWide: {
    flexDirection: "row",
    alignItems: "center",
  },
  summaryStats: {
    flex: 1,
    gap: spacing.sm,
  },
  summaryNumberRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: spacing.sm,
  },
  summaryNumber: {
    fontSize: 48,
    lineHeight: 52,
    fontWeight: "800",
    letterSpacing: -1.5,
    color: colors.ink,
    fontVariant: ["tabular-nums"],
  },
  summaryOf: {
    fontSize: 17,
    fontWeight: "600",
    color: colors.body,
  },
  progressTrack: {
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.divider,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: radius.pill,
    backgroundColor: colors.success,
  },
  summaryMeta: {
    ...type.meta,
    fontSize: 14,
    fontVariant: ["tabular-nums"],
  },
  summaryAction: {
    gap: spacing.sm,
  },
  summaryActionWide: {
    width: 280,
    paddingLeft: spacing.xl,
    borderLeftWidth: 1,
    borderLeftColor: colors.divider,
  },
  summaryHelp: {
    ...type.meta,
    lineHeight: 18,
  },

  // Colunas
  // No celular os grupos (lista curta) vêm antes da lista de alunos (longa)
  columns: {
    flexDirection: "column-reverse",
    gap: spacing.lg,
  },
  columnsWide: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  colMain: { flex: 3 },
  colSide: { flex: 2 },

  studentRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: 44,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  rowLast: {
    borderBottomWidth: 0,
  },
  studentName: {
    flex: 1,
    fontSize: 15,
    fontWeight: "500",
    color: colors.ink,
  },
  studentNameOff: {
    color: colors.body,
  },
  studentRa: {
    ...type.meta,
    fontVariant: ["tabular-nums"],
  },
  emptyText: {
    ...type.meta,
    padding: spacing.lg,
  },

  groupRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingLeft: spacing.lg + 4,
    paddingRight: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  rowPressed: {
    backgroundColor: colors.bg,
  },
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
  groupInfo: {
    flex: 1,
    alignItems: "flex-start",
    gap: spacing.xs,
  },
  groupName: {
    ...type.itemTitle,
  },
  groupCount: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.primary,
    fontVariant: ["tabular-nums"],
  },
  groupsFoot: {
    ...type.meta,
    fontSize: 12,
    padding: spacing.lg,
  },

  // Modal de adicionar alunos
  textArea: {
    minHeight: 160,
    textAlignVertical: "top",
  },
  addRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  addInfo: {
    ...type.meta,
  },
  addHint: {
    ...type.meta,
    fontSize: 12,
    marginTop: spacing.md,
  },
});
