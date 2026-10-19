import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createElement } from "react";
import { render, toPlainText } from "react-email";
import InvitationEmail from "../src/emails/invitation";

async function main() {
  const output = resolve("test-results/emails");
  const logo = await readFile(resolve("public/email/taskode-mark.png"));
  const html = await render(
    createElement(InvitationEmail, {
      ...InvitationEmail.PreviewProps,
      logoUrl: `data:image/png;base64,${logo.toString("base64")}`,
    }),
  );
  await mkdir(output, { recursive: true });
  const htmlPath = resolve(output, "invitation.html");
  await writeFile(htmlPath, html, "utf8");
  await writeFile(resolve(output, "invitation.txt"), toPlainText(html), "utf8");
  console.log(`Vista previa: ${pathToFileURL(htmlPath).href}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
