import { useState } from "react";
import { PROFILE_QUESTIONS, answersToProfile, type ProfileAnswers, type Chronotype } from "@/domain/profile";
import { saveProfile, pushProfile } from "@/store/profile";
import { useStore } from "@/store/useStore";

interface Props {
  onComplete: () => void;
  /** Si es desde Ajustes, permite cancelar. */
  canCancel?: boolean;
  onCancel?: () => void;
}

export default function ProfileQuestionnaire({ onComplete, canCancel, onCancel }: Props) {
  const pushToast = useStore((s) => s.pushToast);
  const [step, setStep] = useState(0);
  const [newActivity, setNewActivity] = useState("");
  const [answers, setAnswers] = useState<ProfileAnswers>({
    wakeTime: "07:00",
    sleepTime: "22:30",
    chronotype: "matutino",
    workStart: "09:00",
    workEnd: "18:00",
    activities: [],
    breakMin: 10,
  });

  const q = PROFILE_QUESTIONS[step];
  const isLast = step === PROFILE_QUESTIONS.length - 1;
  const progress = ((step + 1) / PROFILE_QUESTIONS.length) * 100;

  const setAnswer = (key: string, value: unknown) => {
    setAnswers((prev) => ({ ...prev, [key]: value }));
  };

  const toggleActivity = (activity: string) => {
    setAnswers((prev) => ({
      ...prev,
      activities: prev.activities.includes(activity)
        ? prev.activities.filter((a) => a !== activity)
        : [...prev.activities, activity],
    }));
  };

  const addCustomActivity = () => {
    const name = newActivity.trim();
    if (!name) return;
    if (!answers.activities.includes(name)) {
      setAnswers((prev) => ({ ...prev, activities: [...prev.activities, name] }));
    }
    setNewActivity("");
  };

  const next = () => {
    if (isLast) {
      const profile = answersToProfile(answers);
      saveProfile(profile);
      void pushProfile();
      pushToast("Perfil guardado — la IA lo usará para recomendarte horarios");
      onComplete();
    } else {
      setStep((s) => s + 1);
    }
  };

  const back = () => {
    if (step > 0) setStep((s) => s - 1);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div
        className="card w-full max-w-lg p-6 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label="Cuestionario de perfil"
      >
        {/* Header */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-muted">
              Paso {step + 1} de {PROFILE_QUESTIONS.length}
            </span>
            {canCancel && (
              <button
                type="button"
                onClick={onCancel}
                className="text-xs text-muted hover:text-primary"
              >
                Cancelar
              </button>
            )}
          </div>
          {/* Barra de progreso */}
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-hover">
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{ width: `${progress}%`, background: "var(--accent)" }}
            />
          </div>
        </div>

        {/* Pregunta */}
        <div className="mb-6">
          <div className="text-3xl mb-2">{q.emoji}</div>
          <h2 className="font-display text-xl font-semibold">{q.question}</h2>
        </div>

        {/* Input según tipo */}
        <div className="mb-6">
          {q.type === "time" && (
            <input
              type="time"
              value={answers[q.key as keyof ProfileAnswers] as string}
              onChange={(e) => setAnswer(q.key, e.target.value)}
              className="input text-center text-2xl"
              autoFocus
            />
          )}

          {q.type === "choice" && (
            <div className="space-y-2">
              {q.options.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setAnswer(q.key, opt.value)}
                  className={`block w-full rounded-xl border px-4 py-3 text-left text-sm transition-all ${
                    answers.chronotype === opt.value
                      ? "border-[var(--accent)] bg-[var(--accent-soft)] text-primary"
                      : "border-theme bg-surface text-primary hover:opacity-80"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}

          {q.type === "range" && (
            <div className="flex items-center gap-3">
              <input
                type="time"
                value={answers.workStart}
                onChange={(e) => setAnswer("workStart", e.target.value)}
                className="input text-center text-lg"
                aria-label="Inicio de trabajo"
              />
              <span className="text-muted">—</span>
              <input
                type="time"
                value={answers.workEnd}
                onChange={(e) => setAnswer("workEnd", e.target.value)}
                className="input text-center text-lg"
                aria-label="Fin de trabajo"
              />
            </div>
          )}

          {q.type === "multi" && (
            <div>
              <div className="grid grid-cols-2 gap-2 mb-3">
                {q.options.map((activity) => (
                  <button
                    key={activity}
                    type="button"
                    onClick={() => toggleActivity(activity)}
                    className={`rounded-xl border px-3 py-2.5 text-sm transition-all ${
                      answers.activities.includes(activity)
                        ? "border-[var(--accent)] bg-[var(--accent-soft)] text-primary"
                        : "border-theme bg-surface text-primary hover:opacity-80"
                    }`}
                  >
                    {answers.activities.includes(activity) ? "✓ " : ""}
                    {activity}
                  </button>
                ))}
                {/* Actividades personalizadas ya añadidas */}
                {answers.activities
                  .filter((a) => !q.options.includes(a as never))
                  .map((activity) => (
                    <button
                      key={activity}
                      type="button"
                      onClick={() => toggleActivity(activity)}
                      className="rounded-xl border border-[var(--accent)] bg-[var(--accent-soft)] px-3 py-2.5 text-sm text-primary transition-all"
                    >
                      ✓ {activity}
                    </button>
                  ))}
              </div>
              {/* Campo para añadir actividad propia */}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newActivity}
                  onChange={(e) => setNewActivity(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addCustomActivity();
                    }
                  }}
                  placeholder="Añadir otra actividad..."
                  className="input flex-1 text-sm"
                  aria-label="Añadir actividad personalizada"
                />
                <button
                  type="button"
                  onClick={addCustomActivity}
                  disabled={!newActivity.trim()}
                  className="btn-ghost text-sm"
                >
                  + Añadir
                </button>
              </div>
            </div>
          )}

          {q.type === "number" && (
            <div>
              <div className="flex items-center gap-3 mb-2">
                <input
                  type="range"
                  min={0}
                  max={60}
                  step={5}
                  value={answers.breakMin}
                  onChange={(e) => setAnswer("breakMin", Number(e.target.value))}
                  className="flex-1"
                  aria-label="Minutos de descanso"
                />
                <span className="text-lg font-semibold text-primary w-20 text-center">
                  {answers.breakMin} min
                </span>
              </div>
              <div className="flex justify-between text-xs text-muted px-1">
                <span>0</span>
                <span>15</span>
                <span>30</span>
                <span>45</span>
                <span>60</span>
              </div>
            </div>
          )}
        </div>

        {/* Navegación */}
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={back}
            disabled={step === 0}
            className="btn-ghost text-sm"
          >
            ← Atrás
          </button>
          <button
            type="button"
            onClick={next}
            className="btn-primary text-sm"
          >
            {isLast ? "✅ Guardar perfil" : "Siguiente →"}
          </button>
        </div>
      </div>
    </div>
  );
}
