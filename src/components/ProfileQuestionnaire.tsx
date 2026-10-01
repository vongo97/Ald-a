import { useState } from "react";
import { PROFILE_QUESTIONS, answersToProfile, type ProfileAnswers, type Chronotype } from "@/domain/profile";
import { saveProfile, pushProfile } from "@/store/profile";
import { supabase } from "@/store/supabase";
import { useStore } from "@/store/useStore";

interface Props {
  onComplete: () => void;
  /** Si es desde Ajustes, permite cancelar. */
  canCancel?: boolean;
  onCancel?: () => void;
}

export default function ProfileQuestionnaire({ onComplete, canCancel, onCancel }: Props) {
  const pushToast = useStore((s) => s.pushToast);
  const session = useStore((s) => s.session);
  const [step, setStep] = useState(0);
  const [authLoading, setAuthLoading] = useState(false);
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

  // Iniciar sesión ANTES de rellenar: al volver del OAuth la app recarga, baja
  // el perfil de la nube y, si existe, este cuestionario ni aparece. Sin esto,
  // un dispositivo nuevo crearía un perfil local por encima del de la nube.
  const handleSignIn = async () => {
    setAuthLoading(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
    if (error) pushToast(`Error: ${error.message}`);
    setAuthLoading(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div
        className="modal-card w-full max-w-lg p-6 shadow-2xl"
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

        {/* Iniciar sesión antes de crear un perfil nuevo */}
        {!session && (
          <div className="mb-6 rounded-xl border border-theme bg-surface-hover p-3">
            <p className="mb-2 text-xs text-muted">
              ¿Ya usas la app en otro dispositivo? Inicia sesión y traemos tu
              perfil en vez de crearlo de cero.
            </p>
            <button
              type="button"
              className="btn-ghost flex w-full items-center justify-center gap-2 border border-theme"
              disabled={authLoading}
              onClick={() => void handleSignIn()}
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              {authLoading ? "Abriendo Google…" : "Iniciar sesión con Google"}
            </button>
          </div>
        )}

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
