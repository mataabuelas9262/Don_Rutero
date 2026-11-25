package com.rutabus.service;

import jakarta.mail.internet.MimeMessage;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.MimeMessageHelper;
import org.springframework.stereotype.Service;

import javax.naming.NameNotFoundException;
import javax.naming.directory.Attribute;
import javax.naming.directory.Attributes;
import javax.naming.directory.DirContext;
import javax.naming.directory.InitialDirContext;
import java.util.Hashtable;
import java.util.Optional;

@Service
public class EmailService {

    private static final Logger log = LoggerFactory.getLogger(EmailService.class);

    @Autowired(required = false)
    private JavaMailSender mailSender;

    @Value("${spring.mail.host:}")
    private String mailHost;

    @Value("${spring.mail.username:}")
    private String mailUsername;

    @Value("${app.mail.from:}")
    private String mailFrom;

    @Value("${app.auth.verify-email-mx:true}")
    private boolean verifyEmailMx;

    public boolean isSmtpConfigured() {
        return mailSender != null
                && mailHost != null && !mailHost.trim().isEmpty()
                && mailUsername != null && !mailUsername.trim().isEmpty();
    }

    /**
     * Verifica por DNS si el dominio del correo existe y tiene registros MX (o A/AAAA de respaldo).
     */
    public boolean hasValidMailDomain(String email) {
        if (!verifyEmailMx) {
            return true;
        }
        int atIdx = email != null ? email.lastIndexOf('@') : -1;
        if (atIdx < 1 || atIdx >= email.length() - 3) {
            return false;
        }
        String domain = email.substring(atIdx + 1).trim().toLowerCase();
        if (!domain.contains(".") || domain.contains("..") || "localhost".equals(domain)) {
            return false;
        }

        Hashtable<String, String> env = new Hashtable<>();
        env.put("java.naming.factory.initial", "com.sun.jndi.dns.DnsContextFactory");
        env.put("com.sun.jndi.dns.timeout.initial", "2000");
        env.put("com.sun.jndi.dns.timeout.retries", "1");

        DirContext ctx = null;
        try {
            ctx = new InitialDirContext(env);
            Attributes mxAttrs = ctx.getAttributes(domain, new String[]{"MX"});
            Attribute mx = mxAttrs != null ? mxAttrs.get("MX") : null;
            if (mx != null && mx.size() > 0) {
                return true;
            }
            // RFC 5321 permite entrega por registro A/AAAA cuando no hay MX explícito
            Attributes aAttrs = ctx.getAttributes(domain, new String[]{"A", "AAAA"});
            Attribute aRec = aAttrs != null ? aAttrs.get("A") : null;
            Attribute aaaaRec = aAttrs != null ? aAttrs.get("AAAA") : null;
            return (aRec != null && aRec.size() > 0) || (aaaaRec != null && aaaaRec.size() > 0);
        } catch (NameNotFoundException e) {
            return false;
        } catch (Exception e) {
            // Si el DNS local falla o expira por red restringida, no bloquear falsamente correos válidos
            log.warn("No se pudo consultar DNS MX para {}: {}", domain, e.getMessage());
            return true;
        } finally {
            if (ctx != null) {
                try {
                    ctx.close();
                } catch (Exception ignored) {
                }
            }
        }
    }

    public boolean sendVerificationCodeEmail(String to, String code) {
        String subject = "Don Rutero — Tu código de verificación";
        String textBody = "Hola,\n\n"
                + "Tu código de verificación para crear tu cuenta en Don Rutero Mazatlán es:\n\n"
                + "    " + code + "\n\n"
                + "Este código expira en 10 minutos.\n"
                + "Si no solicitaste este registro, puedes ignorar este mensaje.";
        String htmlBody = buildCodeEmailHtml(
                "Verifica tu correo en Don Rutero",
                "Usa este código de 6 dígitos para confirmar tu dirección de correo y activar tu cuenta:",
                code,
                "Si no solicitaste crear una cuenta en Don Rutero Mazatlán, puedes ignorar este mensaje."
        );
        return dispatchEmail(to, subject, textBody, htmlBody, code);
    }

    public boolean sendPasswordResetEmail(String to, String code) {
        String subject = "Don Rutero — Código para restablecer tu contraseña";
        String textBody = "Hola,\n\n"
                + "Recibimos una solicitud para restablecer la contraseña de tu cuenta en Don Rutero.\n"
                + "Tu código de seguridad es:\n\n"
                + "    " + code + "\n\n"
                + "Este código expira en 10 minutos.\n"
                + "Si no fuiste tú, ignora este correo y tu contraseña seguirá intacta.";
        String htmlBody = buildCodeEmailHtml(
                "Restablecer contraseña",
                "Recibimos una solicitud para cambiar tu contraseña. Ingresa este código de seguridad:",
                code,
                "Si no pediste este cambio, ignora este mensaje; tu contraseña actual seguirá intacta."
        );
        return dispatchEmail(to, subject, textBody, htmlBody, code);
    }

    private String buildCodeEmailHtml(String title, String subtitle, String code, String footerNote) {
        return "<div style=\"font-family:Arial,Helvetica,sans-serif;background:#f8fafc;padding:24px;\">"
                + "<div style=\"max-width:460px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:14px;padding:26px;color:#0f172a;\">"
                + "<div style=\"font-size:13px;font-weight:700;color:#e84a27;letter-spacing:0.4px;margin-bottom:6px;\">DON RUTERO · MAZATLÁN</div>"
                + "<h2 style=\"margin:0 0 10px 0;font-size:20px;color:#0f172a;\">" + title + "</h2>"
                + "<p style=\"margin:0 0 18px 0;font-size:14px;line-height:1.5;color:#475569;\">" + subtitle + "</p>"
                + "<div style=\"text-align:center;margin:18px 0;\">"
                + "<span style=\"display:inline-block;padding:12px 24px;font-size:28px;font-weight:800;letter-spacing:6px;font-family:monospace;background:#f1f5f9;border:1px solid #cbd5e1;border-radius:10px;color:#0f172a;\">"
                + code + "</span></div>"
                + "<p style=\"margin:0 0 8px 0;font-size:13px;color:#64748b;\">Este código expira en <strong>10 minutos</strong>.</p>"
                + "<hr style=\"border:0;border-top:1px solid #e2e8f0;margin:18px 0;\">"
                + "<p style=\"margin:0;font-size:12px;color:#94a3b8;line-height:1.4;\">" + footerNote + "</p>"
                + "</div></div>";
    }

    private boolean dispatchEmail(String to, String subject, String textBody, String htmlBody, String codeForLog) {
        if (!isSmtpConfigured()) {
            log.info("[DEV-MAIL sin SMTP] Destinatario: {} | Asunto: {} | Código: {}", to, subject, codeForLog);
            return false;
        }
        try {
            MimeMessage msg = mailSender.createMimeMessage();
            MimeMessageHelper helper = new MimeMessageHelper(msg, true, "UTF-8");
            String rawFrom = Optional.ofNullable(mailFrom)
                    .filter(s -> !s.isBlank())
                    .orElseGet(() -> (mailUsername != null && !mailUsername.isBlank()) ? mailUsername.trim() : "no-reply@donrutero.com");
            String formattedFrom = rawFrom.contains("<") ? rawFrom : "Don Rutero <" + rawFrom + ">";
            helper.setFrom(formattedFrom);
            helper.setTo(to);
            helper.setSubject(subject);
            helper.setText(textBody, htmlBody);
            mailSender.send(msg);
            log.info("Correo enviado correctamente por SMTP a {}", to);
            return true;
        } catch (Exception e) {
            log.error("Error al enviar correo SMTP a {}: {}", to, e.getMessage());
            throw new IllegalStateException("No se pudo enviar el correo en este momento. Verifica la configuración SMTP.");
        }
    }
}
