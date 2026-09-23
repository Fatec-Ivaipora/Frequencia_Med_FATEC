import {
    addDoc,
    collection,
    deleteDoc,
    doc,
    getDoc,
    getDocs,
    orderBy,
    query,
    serverTimestamp,
    updateDoc,
} from "firebase/firestore";
import { db } from "./firebase";

const COL = "turmas";

// Turma: { name: "T1", alunos: [{ ra, nome }] }. Os RAs ligam a turma às chamadas.
export async function createTurma({ name, alunos }) {
  const ref = await addDoc(collection(db, COL), {
    name,
    alunos: alunos || [],
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export async function listTurmas() {
  const q = query(collection(db, COL), orderBy("name", "asc"));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function getTurma(id) {
  const snap = await getDoc(doc(db, COL, id));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
}

export async function updateTurmaAlunos(id, alunos) {
  await updateDoc(doc(db, COL, id), { alunos });
}

export async function deleteTurma(id) {
  await deleteDoc(doc(db, COL, id));
}
