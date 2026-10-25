# Plantillas de comentarios

Los comentarios se leen en el hilo de la tarea, a veces semanas después y por alguien que no estuvo en la sesión. Por eso:

- La **primera línea** dice qué pasó (el hito y, si hubo, el cambio de estado). Así el hilo se puede recorrer en diagonal.
- Son concretos: archivos, comandos de prueba con su resultado, ramas, commits y PR. No sirve escribir "se hicieron mejoras".
- Son breves: entre 3 y 10 viñetas. Lo largo va a un documento, y el comentario lo enlaza.
- Terminan con la firma `_— Registrado por Claude Code_`, porque se publican con el nombre del usuario y el equipo debe saber quién los redactó.

Adapta las secciones al caso: borra las que no apliquen y no rellenes por rellenar.

---

## Inicio de implementación (→ En proceso)

```markdown
**▶️ En proceso** · Pendiente → En proceso

Inicio de la implementación. Alcance de esta sesión: <planear e implementar | hasta producción>.

- Enfoque: <1–2 líneas sobre cómo se resolverá>
- Plan: ver checklist de la tarea
- Rama: `<rama>` <si aplica>

_— Registrado por Claude Code_
```

## Entrega para revisión (→ En revisión)

```markdown
**👀 En revisión** · En proceso → En revisión

Implementación terminada y verificada localmente.

**Cambios**
- <qué cambió, en términos de comportamiento>
- Archivos clave: `<ruta>`, `<ruta>`

**Verificación**
- `<comando de pruebas>` → <resultado, p. ej. 24/24 OK>
- <prueba manual realizada, si hubo>

**Git**: rama `<rama>` · commits `<sha corto>` · PR <enlace o "pendiente">

**Para cerrar falta**: <revisión del equipo, despliegue, validación con el cliente…>

_— Registrado por Claude Code_
```

## Cierre en producción (→ estado de cierre)

```markdown
**✅ Terminado** · En revisión → Terminado

Desplegado y verificado en producción.

- Despliegue: <cómo y cuándo: merge a `main`, pipeline, versión>
- Verificación en producción: <qué se comprobó y el resultado>
- Seguimiento posterior: <si queda algo, p. ej. monitorear logs>

_— Registrado por Claude Code_
```

## Resultado de exploración o análisis de viabilidad

```markdown
**🔎 Análisis de viabilidad** — <Viable | Viable con condiciones | No viable>

**Hallazgos**
- <cómo funciona hoy lo relevante, con rutas de archivos>

**Propuesta**
- <enfoque recomendado y alternativas descartadas, con el porqué>

**Riesgos / dudas abiertas**
- <qué podría salir mal o qué hay que definir con alguien>

**Esfuerzo estimado**: <pequeño | medio | grande> — <justificación breve>

<Si es largo: "Detalle completo en el documento «<título>» de esta tarea.">

_— Registrado por Claude Code_
```

## Plan (alcance "solo planear")

```markdown
**🗺️ Plan de implementación**

Plan listo; los pasos están en el checklist de la tarea.

- Enfoque: <resumen>
- Archivos que se tocarán: `<ruta>`, `<ruta>`
- Cómo se verificará: <pruebas>
- Supuestos: <decisiones tomadas sobre requisitos ambiguos>

_— Registrado por Claude Code_
```

## Decisión

```markdown
**🧭 Decisión**: <la decisión en una línea>

- Contexto: <qué obligó a decidir>
- Alternativas consideradas: <opción> — <por qué no>
- Consecuencia: <qué implica para el alcance o para el futuro>

_— Registrado por Claude Code_
```

## Bloqueo o trabajo a medias

```markdown
**⛔ Bloqueo** | **⏸️ Pausa** — <motivo en una línea>

- Hecho hasta ahora: <…>
- Falta: <…>
- Para retomar: <primer paso concreto, rama, archivo>
- Necesita: <decisión, acceso o información, y de quién>

_— Registrado por Claude Code_
```

## Retroceso (→ En proceso tras una revisión)

```markdown
**↩️ De vuelta a En proceso** · En revisión → En proceso

- Motivo: <qué se encontró en la revisión>
- Qué se va a ajustar: <…>

_— Registrado por Claude Code_
```
