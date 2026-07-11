#![allow(non_snake_case)]

use dioxus::prelude::*;

const STYLE: Asset = asset!("/assets/style.css");

#[derive(Clone, Copy, PartialEq)]
struct Exercise {
    id: &'static str,
    name: &'static str,
    group: &'static str,
    kind: ExerciseKind,
}

#[derive(Clone, Copy, PartialEq)]
enum ExerciseKind {
    Charge,
    Bodyweight,
}

#[derive(Clone, Copy, PartialEq)]
struct Set {
    reps: u32,
    weight: f32,
}

#[derive(Clone, Copy, PartialEq)]
struct SessionExercise {
    exo_id: &'static str,
    sets: &'static [Set],
}

#[derive(Clone, Copy, PartialEq)]
struct Session {
    date: &'static str,
    exos: &'static [SessionExercise],
}

const EXERCISES: &[Exercise] = &[
    Exercise { id: "bench", name: "Développé couché", group: "Pectoraux", kind: ExerciseKind::Charge },
    Exercise { id: "squat", name: "Squat", group: "Jambes", kind: ExerciseKind::Charge },
    Exercise { id: "row", name: "Rowing barre", group: "Dos", kind: ExerciseKind::Charge },
    Exercise { id: "pullups", name: "Tractions", group: "Dos", kind: ExerciseKind::Bodyweight },
    Exercise { id: "dips", name: "Dips", group: "Triceps", kind: ExerciseKind::Bodyweight },
    Exercise { id: "press", name: "Développé militaire", group: "Épaules", kind: ExerciseKind::Charge },
];

const SESSIONS: &[Session] = &[
    Session { date: "2026-06-20", exos: &[
        SessionExercise { exo_id: "bench", sets: &[Set { reps: 8, weight: 72.5 }, Set { reps: 7, weight: 72.5 }, Set { reps: 8, weight: 70.0 }] },
        SessionExercise { exo_id: "row", sets: &[Set { reps: 10, weight: 62.5 }, Set { reps: 10, weight: 62.5 }, Set { reps: 9, weight: 62.5 }] },
        SessionExercise { exo_id: "dips", sets: &[Set { reps: 12, weight: 0.0 }, Set { reps: 10, weight: 0.0 }] },
    ] },
    Session { date: "2026-06-25", exos: &[
        SessionExercise { exo_id: "squat", sets: &[Set { reps: 8, weight: 95.0 }, Set { reps: 8, weight: 95.0 }, Set { reps: 6, weight: 100.0 }] },
        SessionExercise { exo_id: "pullups", sets: &[Set { reps: 8, weight: 0.0 }, Set { reps: 7, weight: 0.0 }, Set { reps: 6, weight: 0.0 }] },
        SessionExercise { exo_id: "press", sets: &[Set { reps: 8, weight: 42.5 }, Set { reps: 7, weight: 42.5 }] },
    ] },
    Session { date: "2026-07-02", exos: &[
        SessionExercise { exo_id: "bench", sets: &[Set { reps: 8, weight: 75.0 }, Set { reps: 7, weight: 75.0 }, Set { reps: 6, weight: 75.0 }] },
        SessionExercise { exo_id: "row", sets: &[Set { reps: 10, weight: 65.0 }, Set { reps: 10, weight: 65.0 }, Set { reps: 8, weight: 67.5 }] },
        SessionExercise { exo_id: "dips", sets: &[Set { reps: 13, weight: 0.0 }, Set { reps: 11, weight: 0.0 }] },
    ] },
    Session { date: "2026-07-08", exos: &[
        SessionExercise { exo_id: "squat", sets: &[Set { reps: 8, weight: 100.0 }, Set { reps: 7, weight: 102.5 }, Set { reps: 6, weight: 102.5 }] },
        SessionExercise { exo_id: "pullups", sets: &[Set { reps: 9, weight: 0.0 }, Set { reps: 8, weight: 0.0 }, Set { reps: 7, weight: 0.0 }] },
        SessionExercise { exo_id: "press", sets: &[Set { reps: 8, weight: 45.0 }, Set { reps: 7, weight: 45.0 }, Set { reps: 6, weight: 45.0 }] },
    ] },
];

fn main() {
    dioxus::launch(App);
}

fn App() -> Element {
    let mut selected = use_signal(|| vec!["bench", "row", "dips"]);
    let total_sets = total_sets();
    let total_volume = total_volume();
    let bests = best_volume_by_exercise();

    rsx! {
        document::Link { rel: "stylesheet", href: STYLE }
        div { class: "shell",
            header { class: "top",
                div { class: "brand", span { class: "dot" } "Muscu Tracker" }
                div { class: "sync", "Rust + Dioxus bench" }
            }
            main { class: "layout",
                section {
                    div { class: "hero",
                        h1 { "Nouvelle séance" }
                        p { class: "sub", "Sélection rapide, KPI et historique synthétique pour comparer le coût runtime Dioxus avec le frontend JavaScript actuel." }
                    }
                    div { class: "stats",
                        StatCard { value: SESSIONS.len().to_string(), label: "Séances" }
                        StatCard { value: total_sets.to_string(), label: "Séries" }
                        StatCard { value: format!("{total_volume:.0}"), label: "Volume kg" }
                        StatCard { value: EXERCISES.len().to_string(), label: "Exercices" }
                    }
                    div { class: "card",
                        h2 { "Choisis tes exos" }
                        div { class: "chips",
                            for exercise in EXERCISES {
                                ExerciseChip {
                                    exercise: *exercise,
                                    active: selected.read().contains(&exercise.id),
                                    onclick: move |_| {
                                        let mut items = selected.write();
                                        if let Some(index) = items.iter().position(|id| *id == exercise.id) {
                                            items.remove(index);
                                        } else {
                                            items.push(exercise.id);
                                        }
                                    }
                                }
                            }
                        }
                    }
                    button { class: "primary", "Commencer la séance ({selected.read().len()} exos)" }
                }
                aside {
                    div { class: "card",
                        h2 { "Progression par exo" }
                        div { class: "bars",
                            for (name, volume, pct) in bests {
                                div { class: "bar",
                                    span { "{name}" }
                                    div { class: "track", div { class: "fill", style: "width: {pct}%" } }
                                    span { "{volume:.0} kg" }
                                }
                            }
                        }
                    }
                    div { class: "card",
                        h2 { "Historique" }
                        for session in SESSIONS.iter().rev() {
                            SessionRow { session: *session }
                        }
                    }
                }
            }
        }
    }
}

#[component]
fn StatCard(value: String, label: &'static str) -> Element {
    rsx! {
        div { class: "stat",
            strong { "{value}" }
            span { "{label}" }
        }
    }
}

#[component]
fn ExerciseChip(exercise: Exercise, active: bool, onclick: EventHandler<MouseEvent>) -> Element {
    let class = if active { "chip active" } else { "chip" };
    let kind = match exercise.kind {
        ExerciseKind::Charge => "Charge",
        ExerciseKind::Bodyweight => "Poids du corps",
    };

    rsx! {
        button { class, onclick,
            strong { "{exercise.name}" }
            small { "{exercise.group} · {kind}" }
        }
    }
}

#[component]
fn SessionRow(session: Session) -> Element {
    rsx! {
        div { class: "workout-row",
            div {
                strong { "{session.date}" }
                div { class: "sets", "{session.exos.len()} exos · {session_set_count(session)} séries" }
            }
            div { class: "sets", "{session_volume(session):.0} kg" }
        }
    }
}

fn exercise_name(id: &str) -> &'static str {
    EXERCISES.iter().find(|exercise| exercise.id == id).map(|exercise| exercise.name).unwrap_or("Exercice")
}

fn session_set_count(session: Session) -> usize {
    session.exos.iter().map(|exercise| exercise.sets.len()).sum()
}

fn session_volume(session: Session) -> f32 {
    session.exos.iter()
        .flat_map(|exercise| exercise.sets.iter())
        .map(|set| set.reps as f32 * set.weight)
        .sum()
}

fn total_sets() -> usize {
    SESSIONS.iter().copied().map(session_set_count).sum()
}

fn total_volume() -> f32 {
    SESSIONS.iter().copied().map(session_volume).sum()
}

fn best_volume_by_exercise() -> Vec<(&'static str, f32, u32)> {
    let mut rows: Vec<_> = EXERCISES.iter()
        .map(|exercise| {
            let volume = SESSIONS.iter()
                .flat_map(|session| session.exos.iter())
                .filter(|item| item.exo_id == exercise.id)
                .map(|item| item.sets.iter().map(|set| set.reps as f32 * set.weight).sum::<f32>())
                .fold(0.0, f32::max);
            (exercise_name(exercise.id), volume)
        })
        .filter(|(_, volume)| *volume > 0.0)
        .collect();
    rows.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap());
    let max = rows.first().map(|row| row.1).unwrap_or(1.0);
    rows.into_iter().map(|(name, volume)| (name, volume, ((volume / max) * 100.0).round() as u32)).collect()
}
