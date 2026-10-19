import type { CSSProperties } from "react";
import {
  Body,
  Button,
  Column,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Img,
  Link,
  Preview,
  Row,
  Section,
  Text,
} from "react-email";

export type InvitationEmailProps = {
  to: string;
  url: string;
  inviter: string;
  logoUrl?: string;
};

const colors = {
  background: "#f1f4f3",
  forest: "#101f1e",
  mint: "#77e6b5",
  text: "#263c33",
  muted: "#62776c",
  border: "#dce4df",
};

export default function InvitationEmail({
  to,
  url,
  inviter,
  logoUrl = new URL("/email/taskode-mark.png", url).toString(),
}: InvitationEmailProps) {
  return (
    <Html lang="es">
      <Head>
        <meta name="color-scheme" content="light" />
        <meta name="supported-color-schemes" content="light" />
        <style>{`
          @media only screen and (max-width: 600px) {
            .email-shell > tbody > tr > td { padding: 20px 12px !important; }
            .email-hero > tbody > tr > td { padding: 28px 24px 32px !important; }
            .email-content > tbody > tr > td { padding: 28px 24px 32px !important; }
            .email-title { font-size: 34px !important; line-height: 39px !important; }
            .email-button { box-sizing: border-box !important; width: 100% !important; text-align: center !important; }
          }
        `}</style>
      </Head>
      <Preview>{inviter} te invita a Taskode. Tu próxima entrega empieza en equipo.</Preview>
      <Body lang="es" style={styles.body}>
        <Section className="email-shell" style={styles.shell}>
          <Container style={styles.container}>
            <Section className="email-hero" style={styles.hero}>
              <Row data-skip-in-text="true">
                <Column style={{ width: "46px", verticalAlign: "middle" }}>
                  <Img src={logoUrl} width="34" height="34" alt="" />
                </Column>
                <Column style={{ verticalAlign: "middle" }}>
                  <Text style={styles.brand}>Taskode</Text>
                </Column>
              </Row>
              <Text style={styles.eyebrow}>INVITACIÓN AL EQUIPO</Text>
              <Heading className="email-title" as="h1" style={styles.title}>
                Tu equipo<br />
                <span style={{ color: colors.mint }}>te espera.</span>
              </Heading>
              <Text style={styles.heroDescription}>
                Del backlog al siguiente deploy, juntos.
              </Text>
            </Section>

            <Section className="email-content" style={styles.content}>
              <Text style={styles.intro}>
                <strong style={{ color: colors.forest }}>{inviter}</strong> te ha
                invitado a colaborar en <strong>Taskode</strong>.
              </Text>
              <Text style={styles.description}>
                Un espacio para conectar proyectos, features y tareas, y construir
                lo que sigue con tu equipo.
              </Text>

              <Section style={styles.account}>
                <Text style={styles.accountLabel}>TU CORREO DE ACCESO</Text>
                <Text style={styles.accountEmail}>{to}</Text>
                <Text style={styles.accountHint}>
                  Acepta la invitación e inicia sesión con Google o GitHub usando
                  esta misma dirección de correo.
                </Text>
              </Section>

              <Section style={styles.action}>
                <Button className="email-button" href={url} style={styles.button}>
                  Aceptar invitación <span aria-hidden="true">&rarr;</span>
                </Button>
                <Text style={styles.expiration}>
                  El enlace vence en <strong>7 días</strong>.
                </Text>
              </Section>

              <Hr style={styles.divider} />
              <Text style={styles.fallbackLabel}>
                Si el botón no funciona, copia y pega este enlace en tu navegador:
              </Text>
              <Link href={url} style={styles.fallbackLink}>{url}</Link>
            </Section>
          </Container>

          <Container style={styles.footer}>
            <Text style={styles.footerBrand}>
              Taskode <span style={{ color: "#9aac9f" }}>·</span> Tu desarrollo,
              organizado.
            </Text>
            <Text style={styles.footerNote}>
              Esta invitación es personal y está dirigida a {to}. Si no la
              esperabas, puedes ignorar este correo.
            </Text>
          </Container>
        </Section>
      </Body>
    </Html>
  );
}

InvitationEmail.PreviewProps = {
  inviter: "Mariana López",
  to: "alex@ejemplo.com",
  url: "https://taskode.example/invite/ejemplo-de-invitacion",
} satisfies InvitationEmailProps;

const styles = {
  body: {
    margin: 0,
    backgroundColor: colors.background,
    color: colors.text,
    fontFamily: '"Segoe UI", Arial, sans-serif',
    WebkitTextSizeAdjust: "100%",
  },
  shell: { padding: "40px 16px" },
  container: {
    width: "100%",
    maxWidth: "560px",
    overflow: "hidden",
    border: `1px solid ${colors.border}`,
    borderRadius: "18px",
    backgroundColor: "#ffffff",
  },
  hero: {
    padding: "32px 40px 34px",
    borderTop: `4px solid ${colors.mint}`,
    borderRadius: "17px 17px 0 0",
    backgroundColor: colors.forest,
  },
  brand: {
    margin: 0,
    color: "#f1f7f5",
    fontSize: "24px",
    fontWeight: 700,
    letterSpacing: "-0.8px",
    lineHeight: "34px",
  },
  eyebrow: {
    margin: "32px 0 12px",
    color: "#a5c7b8",
    fontFamily: "Consolas, 'Courier New', monospace",
    fontSize: "10px",
    fontWeight: 600,
    letterSpacing: "1.8px",
    lineHeight: "18px",
  },
  title: {
    margin: 0,
    color: "#f1f7f5",
    fontSize: "40px",
    fontWeight: 700,
    letterSpacing: "-1.5px",
    lineHeight: "44px",
  },
  heroDescription: {
    margin: "16px 0 0",
    color: "#acbfb8",
    fontSize: "14px",
    lineHeight: "22px",
  },
  content: { padding: "30px 40px 34px" },
  intro: {
    margin: "0 0 8px",
    fontSize: "16px",
    lineHeight: "26px",
    overflowWrap: "anywhere",
  },
  description: {
    margin: "0 0 24px",
    color: colors.muted,
    fontSize: "14px",
    lineHeight: "23px",
  },
  account: {
    padding: "18px 20px",
    border: `1px solid ${colors.border}`,
    borderRadius: "10px",
    backgroundColor: "#f5f8f6",
  },
  accountLabel: {
    margin: "0 0 6px",
    color: colors.muted,
    fontFamily: "Consolas, 'Courier New', monospace",
    fontSize: "10px",
    fontWeight: 600,
    letterSpacing: "1.2px",
    lineHeight: "16px",
  },
  accountEmail: {
    margin: "0 0 8px",
    color: colors.forest,
    fontSize: "16px",
    fontWeight: 600,
    lineHeight: "24px",
    overflowWrap: "anywhere",
    wordBreak: "break-word",
  },
  accountHint: {
    margin: 0,
    color: colors.muted,
    fontSize: "13px",
    lineHeight: "21px",
  },
  action: { padding: "26px 0 0" },
  button: {
    padding: "16px 26px",
    borderRadius: "8px",
    backgroundColor: colors.mint,
    color: "#10251f",
    fontSize: "14px",
    fontWeight: 700,
    lineHeight: "20px",
    textDecoration: "none",
  },
  expiration: {
    margin: "12px 0 0",
    color: colors.muted,
    fontSize: "12px",
    lineHeight: "20px",
  },
  divider: { margin: "24px 0 20px", borderColor: colors.border },
  fallbackLabel: {
    margin: "0 0 8px",
    color: colors.muted,
    fontSize: "12px",
    lineHeight: "20px",
  },
  fallbackLink: {
    color: "#07835e",
    fontSize: "12px",
    lineHeight: "20px",
    textDecoration: "underline",
    overflowWrap: "anywhere",
    wordBreak: "break-all",
  },
  footer: { width: "100%", maxWidth: "520px", padding: "22px 12px 0" },
  footerBrand: {
    margin: "0 0 8px",
    color: "#456153",
    fontSize: "12px",
    fontWeight: 600,
    lineHeight: "20px",
    textAlign: "center",
  },
  footerNote: {
    margin: 0,
    color: colors.muted,
    fontSize: "11px",
    lineHeight: "18px",
    textAlign: "center",
    overflowWrap: "anywhere",
  },
} satisfies Record<string, CSSProperties>;
