// Cartão de vacinas (checklist) — puro, sem DOM/fetch/Date.now() implícito, testável com node:test.
// Catálogo baseado no calendário fornecido pelo usuário (Calendário Nacional de Vacinação/PNI 2026 +
// complementares recomendadas pela SBP). Datas são calculadas a partir de `baby.birth`; sempre confira
// com o pediatra e a caderneta de vacinação — calendários e marcas disponíveis variam por posto/rede.
export const VACCINE_SOURCE_NOTE =
  "Calendário Nacional de Vacinação (PNI) 2026 e recomendações complementares da Sociedade Brasileira de " +
  "Pediatria (SBP). Confira sempre as datas e disponibilidade com o pediatra e a UBS — o calendário oficial " +
  "e as marcas disponíveis podem mudar.";

export const VACCINE_CATALOG = [
  { ageMonths: 0, ageLabel: "Ao nascer", vaccine: "BCG", doseLabel: "Única", category: "sus", protects: "Formas graves de tuberculose" },
  { ageMonths: 0, ageLabel: "Ao nascer", vaccine: "Hepatite B", doseLabel: "1ª dose", category: "sus", protects: "Hepatite B" },

  { ageMonths: 2, ageLabel: "2 meses", vaccine: "Penta (DTP/Hib/HB)", doseLabel: "1ª dose", category: "sus", protects: "Difteria, tétano, coqueluche, Hib e hepatite B" },
  { ageMonths: 2, ageLabel: "2 meses", vaccine: "VIP (Poliomielite)", doseLabel: "1ª dose", category: "sus", protects: "Poliomielite (paralisia infantil)" },
  { ageMonths: 2, ageLabel: "2 meses", vaccine: "Pneumocócica 20-valente", doseLabel: "1ª dose", category: "sus", protects: "Doenças causadas pelo pneumococo (pneumonias, meningites, otites)" },
  { ageMonths: 2, ageLabel: "2 meses", vaccine: "Rotavírus (oral)", doseLabel: "1ª dose", category: "sus", protects: "Gastroenterite por rotavírus" },
  { ageMonths: 2, ageLabel: "2 meses", vaccine: "Meningocócica B", doseLabel: "1ª dose", category: "particular", protects: "Doença meningocócica (sorogrupo B)" },
  { ageMonths: 2, ageLabel: "2 meses", vaccine: "Meningocócica ACWY", doseLabel: "1ª dose", category: "particular", protects: "Doença meningocócica (sorogrupos A, C, W e Y)" },

  { ageMonths: 3, ageLabel: "3 meses", vaccine: "Meningocócica C", doseLabel: "1ª dose", category: "sus", protects: "Doença meningocócica (sorogrupo C)" },
  { ageMonths: 3, ageLabel: "3 meses", vaccine: "Meningocócica B", doseLabel: "2ª dose", category: "particular", protects: "Doença meningocócica (sorogrupo B)" },
  { ageMonths: 3, ageLabel: "3 meses", vaccine: "Meningocócica ACWY", doseLabel: "2ª dose (conforme esquema)", category: "particular", protects: "Doença meningocócica (sorogrupos A, C, W e Y)" },

  { ageMonths: 4, ageLabel: "4 meses", vaccine: "Penta (DTP/Hib/HB)", doseLabel: "2ª dose", category: "sus", protects: "Difteria, tétano, coqueluche, Hib e hepatite B" },
  { ageMonths: 4, ageLabel: "4 meses", vaccine: "VIP (Poliomielite)", doseLabel: "2ª dose", category: "sus", protects: "Poliomielite (paralisia infantil)" },
  { ageMonths: 4, ageLabel: "4 meses", vaccine: "Pneumocócica", doseLabel: "2ª dose", category: "sus", protects: "Doenças causadas pelo pneumococo (pneumonias, meningites, otites)" },
  { ageMonths: 4, ageLabel: "4 meses", vaccine: "Rotavírus (oral)", doseLabel: "2ª dose", category: "sus", protects: "Gastroenterite por rotavírus" },
  { ageMonths: 4, ageLabel: "4 meses", vaccine: "Pneumocócica conjugada (conforme vacina escolhida)", doseLabel: "2ª dose", category: "particular", protects: "Doenças causadas pelo pneumococo (pneumonias, meningites, otites)" },

  { ageMonths: 5, ageLabel: "5 meses", vaccine: "Meningocócica C", doseLabel: "2ª dose", category: "sus", protects: "Doença meningocócica (sorogrupo C)" },
  { ageMonths: 5, ageLabel: "5 meses", vaccine: "Meningocócica ACWY", doseLabel: "2ª dose (conforme esquema)", category: "particular", protects: "Doença meningocócica (sorogrupos A, C, W e Y)" },

  { ageMonths: 6, ageLabel: "6 meses", vaccine: "Penta (DTP/Hib/HB)", doseLabel: "3ª dose", category: "sus", protects: "Difteria, tétano, coqueluche, Hib e hepatite B" },
  { ageMonths: 6, ageLabel: "6 meses", vaccine: "VIP (Poliomielite)", doseLabel: "3ª dose", category: "sus", protects: "Poliomielite (paralisia infantil)" },
  { ageMonths: 6, ageLabel: "6 meses", vaccine: "Meningocócica B (conforme esquema)", doseLabel: "3ª dose ou reforço", category: "particular", protects: "Doença meningocócica (sorogrupo B)" },

  { ageMonths: 12, ageLabel: "12 meses", vaccine: "Pneumocócica 20-valente", doseLabel: "Reforço", category: "sus", protects: "Doenças causadas pelo pneumococo (pneumonias, meningites, otites)" },
  { ageMonths: 12, ageLabel: "12 meses", vaccine: "Meningocócica ACWY", doseLabel: "1ª dose", category: "sus", protects: "Doença meningocócica (sorogrupos A, C, W e Y)" },
  { ageMonths: 12, ageLabel: "12 meses", vaccine: "Tríplice viral (SCR)", doseLabel: "1ª dose", category: "sus", protects: "Sarampo, caxumba e rubéola" },
  { ageMonths: 12, ageLabel: "12 meses", vaccine: "Meningocócica B", doseLabel: "Reforço", category: "particular", protects: "Doença meningocócica (sorogrupo B)" },

  { ageMonths: 15, ageLabel: "15 meses", vaccine: "DTP", doseLabel: "Reforço", category: "sus", protects: "Difteria, tétano e coqueluche" },
  { ageMonths: 15, ageLabel: "15 meses", vaccine: "VIP (Poliomielite)", doseLabel: "Reforço", category: "sus", protects: "Poliomielite (paralisia infantil)" },
  { ageMonths: 15, ageLabel: "15 meses", vaccine: "Tríplice viral (SCR)", doseLabel: "2ª dose", category: "sus", protects: "Sarampo, caxumba e rubéola" },
  { ageMonths: 15, ageLabel: "15 meses", vaccine: "Varicela", doseLabel: "1ª dose", category: "sus", protects: "Catapora (varicela)" },
  { ageMonths: 15, ageLabel: "15 meses", vaccine: "Hepatite A", doseLabel: "1ª dose", category: "sus", protects: "Hepatite A" },
  { ageMonths: 15, ageLabel: "15 meses", vaccine: "Complementações particulares", doseLabel: "conforme orientação do pediatra", category: "particular", protects: "Reforços/vacinas adicionais conforme avaliação médica" },

  { ageMonths: 48, ageLabel: "4 anos", vaccine: "DTP", doseLabel: "Reforço", category: "sus", protects: "Difteria, tétano e coqueluche" },
  { ageMonths: 48, ageLabel: "4 anos", vaccine: "Revisão do calendário vacinal", doseLabel: "conforme orientação do pediatra", category: "sus", protects: "Reforços e demais vacinas conforme calendário vigente" },
];

// Preserva o mês corretamente mesmo perto do fim do mês (ex.: nascido em 31/01 + 1 mês = 28 ou 29/02,
// nunca "vaza" para março). Usa hora local, igual ao resto do app (`new Date(...).getDate()` etc.).
export function addMonths(baseMs, months) {
  const d = new Date(baseMs);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  const lastDayOfTargetMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, lastDayOfTargetMonth));
  return d.getTime();
}

function slugify(s) {
  return String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

// Gera o calendário completo (com `catalogId` estável e `dueAt` calculado) a partir da data de
// nascimento. `catalogId` é a chave de deduplicação: gerar de novo nunca cria linhas repetidas,
// porque quem grava sempre casa por esse campo antes de inserir.
export function generateVaccineSchedule(birthMs) {
  return VACCINE_CATALOG.map(entry => ({
    ...entry,
    catalogId: `m${entry.ageMonths}-${slugify(entry.vaccine)}-${slugify(entry.doseLabel || "unica")}`,
    dueAt: addMonths(birthMs, entry.ageMonths),
  }));
}
