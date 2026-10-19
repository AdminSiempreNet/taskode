import { Body, Button, Container, Head, Heading, Html, Preview, Text } from "react-email";

export default function NotificationEmail({ message, title, url }: { message: string; title: string; url: string }) {
  return (
    <Html lang="es">
      <Head />
      <Preview>{message}: {title}</Preview>
      <Body style={{ backgroundColor: "#f1f4f3", fontFamily: "Arial, sans-serif", padding: "32px 12px", color: "#263c33" }}>
        <Container style={{ backgroundColor: "#fff", borderRadius: "16px", padding: "32px", maxWidth: "560px" }}>
          <Text style={{ color: "#101f1e", fontWeight: 700, letterSpacing: "2px" }}>TASKODE</Text>
          <Heading as="h1" style={{ fontSize: "24px", lineHeight: "32px" }}>{message}</Heading>
          <Text style={{ fontSize: "18px", lineHeight: "28px" }}>{title}</Text>
          <Button href={url} style={{ backgroundColor: "#101f1e", color: "#77e6b5", padding: "14px 24px", borderRadius: "8px", fontWeight: 700 }}>Ver en Taskode</Button>
          <Text style={{ color: "#62776c", fontSize: "12px", marginTop: "32px" }}>Este aviso corresponde a un cambio de acceso en tu espacio de trabajo.</Text>
        </Container>
      </Body>
    </Html>
  );
}
