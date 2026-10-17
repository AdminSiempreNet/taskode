import Link from "next/link";
import {
  ArrowRight,
  CalendarDays,
  Check,
  Code2,
  Layers3,
  LayoutGrid,
  ListChecks,
  MoreHorizontal,
  Users,
} from "lucide-react";
import { TaskodeBrand } from "./taskode-brand";

export function LandingPage() {
  return (
    <div className="landing">
      <a className="landing-skip" href="#contenido">
        Ir al contenido
      </a>
      <header className="landing-header landing-container">
        <Link href="/" aria-label="Taskode, inicio">
          <TaskodeBrand />
        </Link>
        <nav aria-label="Navegación principal">
          <a href="#funciones">Funciones</a>
          <a href="#como-funciona">Cómo funciona</a>
          <Link className="landing-nav-cta" href="/login">
            Entrar
            <ArrowRight size={15} />
          </Link>
        </nav>
      </header>

      <main id="contenido">
        <section
          className="landing-hero landing-container"
          aria-labelledby="landing-title"
        >
          <div className="landing-hero-copy">
            <p className="landing-eyebrow">
              <span />
              GESTIÓN DE PROYECTOS PARA DESARROLLADORES
            </p>
            <h1 id="landing-title">
              Tu próximo deploy empieza con <span>un buen plan.</span>
            </h1>
            <p className="landing-lead">
              Dale estructura a tus ideas, claridad a tus tareas y contexto a tu
              equipo. Taskode conecta todo el trabajo de tu proyecto de software
              en un solo espacio.
            </p>
            <div className="landing-actions">
              <Link className="landing-primary" href="/login">
                Entrar a Taskode
                <ArrowRight size={17} />
              </Link>
              <a className="landing-secondary" href="#funciones">
                Explorar funciones
              </a>
            </div>
            <p className="landing-hero-note">
              Proyectos · Features · Tareas · Equipo
            </p>
          </div>

          <div
            className="landing-preview"
            aria-label="Ejemplo ilustrativo de un proyecto en Taskode"
          >
            <div className="landing-preview-bar">
              <span>
                <Code2 size={17} />
                Mi aplicación web
              </span>
              <span className="landing-preview-tag">PROYECTO</span>
            </div>
            <div className="landing-preview-body">
              <aside
                className="landing-preview-sidebar"
                aria-label="Features de ejemplo"
              >
                <span className="landing-preview-sidebar-title">FEATURES</span>
                <span className="landing-preview-selected">
                  <Layers3 size={13} />
                  Todas las features
                </span>
                <span>
                  <Code2 size={13} />
                  Autenticación
                </span>
                <span>
                  <Code2 size={13} />
                  API de tareas
                </span>
                <span>
                  <Code2 size={13} />
                  Panel de equipo
                </span>
              </aside>
              <div className="landing-preview-workspace">
                <div className="landing-preview-toolbar">
                  <span>
                    <LayoutGrid size={12} />
                    Tablero
                  </span>
                  <span>
                    <ListChecks size={12} />
                    Lista
                  </span>
                  <span>
                    <CalendarDays size={12} />
                    Calendario
                  </span>
                </div>
                <div className="landing-preview-board">
                  <div className="landing-preview-column">
                    <p>
                      <span />
                      Por hacer <small>2</small>
                    </p>
                    <div className="landing-task">
                      <small>FEATURE</small>
                      <strong>Diseñar el perfil de usuario</strong>
                      <span>
                        Frontend
                        <MoreHorizontal size={13} />
                      </span>
                    </div>
                    <div className="landing-task">
                      <small>TAREA</small>
                      <strong>Documentar endpoints</strong>
                      <span>
                        Backend
                        <MoreHorizontal size={13} />
                      </span>
                    </div>
                  </div>
                  <div className="landing-preview-column">
                    <p>
                      <span />
                      En curso <small>1</small>
                    </p>
                    <div className="landing-task">
                      <small>TAREA</small>
                      <strong>Crear API de tareas</strong>
                      <span>
                        Backend
                        <MoreHorizontal size={13} />
                      </span>
                    </div>
                  </div>
                  <div className="landing-preview-column">
                    <p>
                      <span />
                      Hecho <small>1</small>
                    </p>
                    <div className="landing-task landing-task-done">
                      <small>
                        <Check size={11} />
                        TAREA
                      </small>
                      <strong>Configurar el proyecto</strong>
                      <span>
                        Setup
                        <MoreHorizontal size={13} />
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="landing-preview-footer">
              <span>
                <Users size={12} />
                Un equipo. El mismo contexto.
              </span>
              <span>Vista ilustrativa</span>
            </div>
          </div>
        </section>

        <section
          id="funciones"
          className="landing-features landing-container"
          aria-labelledby="features-title"
        >
          <div className="landing-section-heading">
            <p className="landing-eyebrow">DEL BACKLOG A HECHO</p>
            <h2 id="features-title">
              Cada pieza de tu desarrollo,
              <br />
              en su lugar.
            </h2>
          </div>
          <div className="landing-feature-grid">
            <article>
              <Layers3 size={23} />
              <h3>Del proyecto al detalle</h3>
              <p>
                Organiza el trabajo en módulos, features y tareas. Conserva el
                contexto sin perder de vista el proyecto.
              </p>
            </article>
            <article>
              <LayoutGrid size={23} />
              <h3>Tu trabajo, a tu manera</h3>
              <p>
                Alterna entre tablero, lista y calendario. Define estados,
                prioridades y fechas para saber qué sigue.
              </p>
            </article>
            <article>
              <Users size={23} />
              <h3>Un equipo conectado</h3>
              <p>
                Invita a tu equipo, comparte proyectos y reúne comentarios y
                checklists junto a cada tarea.
              </p>
            </article>
          </div>
        </section>

        <section
          id="como-funciona"
          className="landing-steps landing-container"
          aria-labelledby="steps-title"
        >
          <div className="landing-section-heading">
            <p className="landing-eyebrow">UN FLUJO SENCILLO</p>
            <h2 id="steps-title">De una idea a tu próxima entrega.</h2>
          </div>
          <ol>
            <li>
              <span>01</span>
              <div>
                <h3>Crea tu proyecto</h3>
                <p>
                  Dale un nombre y reúne a las personas que lo harán posible.
                </p>
              </div>
            </li>
            <li>
              <span>02</span>
              <div>
                <h3>Divide el trabajo</h3>
                <p>
                  Convierte funcionalidades en tareas concretas, con prioridad y
                  fecha de entrega.
                </p>
              </div>
            </li>
            <li>
              <span>03</span>
              <div>
                <h3>Haz que avance</h3>
                <p>
                  Actualiza los estados y sigue cada tarea hasta completarla.
                </p>
              </div>
            </li>
          </ol>
        </section>

        <section
          className="landing-closing landing-container"
          aria-labelledby="closing-title"
        >
          <div>
            <p className="landing-eyebrow">MENOS DISPERSIÓN. MÁS DIRECCIÓN.</p>
            <h2 id="closing-title">
              Tu código tiene estructura.
              <br />
              Tu trabajo también.
            </h2>
          </div>
          <div>
            <Link className="landing-primary" href="/login">
              Abrir mi espacio
              <ArrowRight size={17} />
            </Link>
            <p>Acceso con Google o GitHub, por invitación.</p>
          </div>
        </section>
      </main>

      <footer className="landing-footer landing-container">
        <TaskodeBrand />
        <span>Del backlog al siguiente deploy.</span>
        <Link href="/login">
          Iniciar sesión
          <ArrowRight size={14} />
        </Link>
      </footer>
    </div>
  );
}
