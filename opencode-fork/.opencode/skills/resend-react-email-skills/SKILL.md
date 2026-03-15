---
name: react-email
description: Create beautiful, responsive HTML emails using React components with React Email. Build transactional emails with modern components, support internationalization, and integrate with email service providers like Resend. Use when creating welcome emails, password resets, notifications, order confirmations, or any HTML email templates.
license: MIT
metadata:
  author: Resend
  repository: https://github.com/resend/react-email
---

# React Email

Build and send HTML emails using React components - a modern, component-based approach to email development that works across all major email clients.

## Quick Start

Install React Email components:

```bash
npm install @react-email/components -E
```

## Basic Email Template

Create an email component with proper structure:

```tsx
import {
  Html,
  Head,
  Preview,
  Body,
  Container,
  Heading,
  Text,
  Button
} from '@react-email/components';

interface WelcomeEmailProps {
  name: string;
  verificationUrl: string;
}

export default function WelcomeEmail({ name, verificationUrl }: WelcomeEmailProps) {
  return (
    <Html lang="en">
      <Head />
      <Preview>Welcome - Verify your email</Preview>
      <Body style={{ backgroundColor: '#f6f9fc', fontFamily: 'Arial, sans-serif' }}>
        <Container style={{ maxWidth: '600px', margin: '0 auto', padding: '20px' }}>
          <Heading style={{ fontSize: '24px', color: '#333' }}>
            Welcome!
          </Heading>
          <Text style={{ fontSize: '16px', color: '#333' }}>
            Hi {name}, thanks for signing up!
          </Text>
          <Button
            href={verificationUrl}
            style={{
              backgroundColor: '#007bff',
              color: '#fff',
              padding: '12px 20px',
              borderRadius: '4px',
              textDecoration: 'none',
              display: 'block',
              textAlign: 'center'
            }}
          >
            Verify Email
          </Button>
        </Container>
      </Body>
    </Html>
  );
}

// Preview props for testing
WelcomeEmail.PreviewProps = {
  name: 'John Doe',
  verificationUrl: 'https://example.com/verify/abc123'
} satisfies WelcomeEmailProps;

export { WelcomeEmail };
```

## Essential Components

See [references/COMPONENTS.md](references/COMPONENTS.md) for complete component documentation.

**Core Structure:**
- `Html` - Root wrapper with `lang` attribute
- `Head` - Meta elements, styles, fonts
- `Body` - Main content wrapper
- `Container` - Centers content (max-width layout)
- `Section` - Layout sections
- `Row` & `Column` - Multi-column layouts

**Content:**
- `Preview` - Inbox preview text, always first in `Body`
- `Heading` - h1-h6 headings
- `Text` - Paragraphs
- `Button` - Styled link buttons
- `Link` - Hyperlinks
- `Img` - Images (use absolute URLs)
- `Hr` - Horizontal dividers

**Specialized:**
- `CodeBlock` - Syntax-highlighted code
- `CodeInline` - Inline code
- `Markdown` - Render markdown
- `Font` - Custom web fonts
- `Tailwind` - Tailwind CSS support

## Rendering and Sending

### Convert to HTML

```tsx
import { render } from '@react-email/components';
import { WelcomeEmail } from './emails/welcome';

const html = await render(
  <WelcomeEmail name="John" verificationUrl="https://example.com/verify" />
);
```

### Send with Resend (Recommended)

**Method 1: MCP Tool**

When you have access to the Resend MCP tool:

```typescript
import { render } from '@react-email/components';
import { WelcomeEmail } from './emails/welcome';

// Render to HTML
const html = await render(
  <WelcomeEmail name="John" verificationUrl="https://example.com/verify" />
);

// Create plain text version
const text = `Welcome!\n\nHi John, thanks for signing up!\n\nVerify: https://example.com/verify`;

// Use Resend MCP send-email tool with:
// - to: recipient@example.com
// - subject: Welcome to Acme
// - html: <rendered html>
// - text: <plain text version>
```

**Method 2: Resend SDK with React**

The most convenient method - pass React components directly:

```tsx
import { Resend } from 'resend';
import { WelcomeEmail } from './emails/welcome';

const resend = new Resend(process.env.RESEND_API_KEY);

const { data, error } = await resend.emails.send({
  from: 'Acme <onboarding@resend.dev>',
  to: ['user@example.com'],
  subject: 'Welcome to Acme',
  react: <WelcomeEmail name="John" verificationUrl="https://example.com/verify" />
});

if (error) {
  console.error('Failed to send:', error);
}
```

This handles the plain-text rendering and HTML rendering for you.

### Send with Other Providers

**Nodemailer:**

```tsx
import { render } from '@react-email/components';
import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host: 'smtp.example.com',
  port: 587,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
});

const html = await render(<WelcomeEmail name="John" verificationUrl="https://example.com/verify" />);

await transporter.sendMail({
  from: 'noreply@example.com',
  to: 'user@example.com',
  subject: 'Welcome',
  html
});
```

**SendGrid:**

```tsx
import { render } from '@react-email/components';
import sgMail from '@sendgrid/mail';

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const html = await render(<WelcomeEmail name="John" verificationUrl="https://example.com/verify" />);

await sgMail.send({
  to: 'user@example.com',
  from: 'noreply@example.com',
  subject: 'Welcome',
  html
});
```

## Internationalization

See [references/I18N.md](references/I18N.md) for complete i18n documentation.

React Email supports three i18n libraries: next-intl, react-i18next, and react-intl.

### Quick Example (next-intl)

```tsx
import { createTranslator } from 'next-intl';
import { Html, Body, Container, Text, Button } from '@react-email/components';

interface EmailProps {
  name: string;
  locale: string;
}

export default async function WelcomeEmail({ name, locale }: EmailProps) {
  const t = createTranslator({
    messages: await import(`../messages/${locale}.json`),
    namespace: 'welcome-email',
    locale
  });

  return (
    <Html lang={locale}>
      <Body>
        <Container>
          <Text>{t('greeting')} {name},</Text>
          <Text>{t('body')}</Text>
          <Button href="https://example.com">{t('cta')}</Button>
        </Container>
      </Body>
    </Html>
  );
}
```

Message files (`messages/en.json`, `messages/es.json`, etc.):

```json
{
  "welcome-email": {
    "greeting": "Hi",
    "body": "Thanks for signing up!",
    "cta": "Get Started"
  }
}
```

## Email Best Practices

1. **Always use inline styles** - Email clients have poor CSS class support. Use the `style` prop on all components. The `Tailwind` component automatically inlines styles.

2. **Test across email clients** - Test in Gmail, Outlook, Apple Mail, Yahoo Mail. Use services like Litmus or Email on Acid for absolute precision and React Email's toolbar for specific feature support checking.

3. **Keep it responsive** - Max-width around 600px, test on mobile devices.

4. **Use absolute image URLs** - Host on reliable CDN, always include `alt` text.

5. **Provide plain text version** - Required for accessibility and some email clients.

6. **Keep file size under 102KB** - Gmail clips larger emails.

7. **Add proper TypeScript types** - Define interfaces for all email props.

8. **Include preview props** - Add `.PreviewProps` to components for development testing.

9. **Handle errors** - Always check for errors when sending emails.

10. **Use verified domains** - For production, use verified domains in `from` addresses.

## Common Patterns

See [references/PATTERNS.md](references/PATTERNS.md) for complete examples including:
- Password reset emails
- Order confirmations with product lists
- Notification emails with code blocks
- Multi-column layouts
- Email templates with custom fonts

## Additional Resources

- [React Email Documentation](https://react.email)
- [React Email GitHub](https://github.com/resend/react-email)
- [Resend Documentation](https://resend.com/docs)
- [Email Client CSS Support](https://www.caniemail.com)
- Component Reference: [references/COMPONENTS.md](references/COMPONENTS.md)
- Internationalization Guide: [references/I18N.md](references/I18N.md)
- Common Patterns: [references/PATTERNS.md](references/PATTERNS.md)


---

## Referenced Files

> The following files are referenced in this skill and included for context.

### references/COMPONENTS.md

```markdown
# React Email Components Reference

Complete reference for all React Email components.

## Structural Components

### Html

Root wrapper for the email. Always use as the outermost component.

```jsx
import { Html } from '@react-email/components';

<Html lang="en" dir="ltr">
  {/* email content */}
</Html>
```

**Props:**
- `lang` - Language code (e.g., "en", "es", "fr")
- `dir` - Text direction ("ltr" or "rtl")

### Head

Contains meta elements, styles, and fonts. If using Tailwind, should be wrapped by `<Tailwind>`.

```jsx
import { Head } from '@react-email/components';

<Head>
  <title>Email Title</title>
</Head>
```

### Body

Main email body wrapper.

```jsx
import { Body } from '@react-email/components';

<Body style={{ backgroundColor: '#f6f9fc', fontFamily: 'Arial, sans-serif' }}>
  {/* email content */}
</Body>
```

### Container

Centers email content using a table, and has a max-width constraint of `37.5em`.

```jsx
import { Container } from '@react-email/components';

<Container>
  {/* centered content */}
</Container>
```

### Section

Layout section that can contain rows and columns.

```jsx
import { Section } from '@react-email/components';

<Section style={{ padding: '20px', backgroundColor: '#fff' }}>
  {/* section content */}
</Section>
```

### Row & Column

Multi-column layouts using table-based rendering.

```jsx
import { Row, Column } from '@react-email/components';

<Section>
  <Row>
    <Column style={{ width: '50%', padding: '10px' }}>
      Left column content
    </Column>
    <Column style={{ width: '50%', padding: '10px' }}>
      Right column content
    </Column>
  </Row>
</Section>
```

**Column widths:**
- Always define both the `width` HTML attribute and the `width` style attribute
- Use percentage widths (e.g., "50%", "33.33%")
- Or fixed pixel widths (e.g., "200px")
- Total should add up to 100% or container width

## Content Components

### Preview

Preview text shown in email inbox before opening.

```jsx
import { Preview } from '@react-email/components';

<Preview>Welcome to our platform - Get started today!</Preview>
```

**Best practices:**
- Keep under 140 characters
- Make it compelling and action-oriented
- Should always be the first element inside `<Body>`

### Heading

Heading text (h1-h6).

```jsx
import { Heading } from '@react-email/components';

<Heading as="h1" style={{ fontSize: '24px', fontWeight: 'bold', color: '#333' }}>
  Welcome to Acme
</Heading>

<Heading as="h2" style={{ fontSize: '20px', fontWeight: '600', color: '#666' }}>
  Getting Started
</Heading>
```

**Props:**
- `as` - HTML heading level ("h1" through "h6")

### Text

Paragraph text component.

```jsx
import { Text } from '@react-email/components';

<Text style={{ fontSize: '16px', lineHeight: '24px', color: '#333' }}>
  Your paragraph content here.
</Text>
```

### Button

Styled link that looks like a button. Has work around for padding issues in Outlook.

```jsx
import { Button } from '@react-email/components';

<Button 
  href="https://example.com/verify"
  target="_blank"
  style={{ 
    backgroundColor: '#007bff', 
    color: '#ffffff',
    padding: '12px 20px',
    borderRadius: '4px',
    textDecoration: 'none',
    textAlign: 'center',
    display: 'block'
  }}
>
  Verify Email Address
</Button>
```

**Props:**
- `href` (required) - URL to link to
- `target` - Default is "_blank"

**Styling tips:**
- Always set `display: block` for full-width buttons
- Use `textAlign: center` for centered text
- Set explicit `backgroundColor` and `color`
- Add `textDecoration: none` to remove underline

### Link

Standard hyperlink.

```jsx
import { Link } from '@react-email/components';

<Link href="https://example.com" target="_blank" style={{ color: '#007bff' }}>
  Visit our website
</Link>
```

**Props:**
- `href` (required) - URL to link to
- `target` - Default is "_blank"

### Img

Image component.

```jsx
import { Img } from '@react-email/components';

<Img 
  src="https://example.com/logo.png" 
  alt="Company Logo"
  width="150"
  height="50"
  style={{ display: 'block', margin: '0 auto' }}
/>
```

**Props:**
- `src` (required) - Image URL (must be absolute)
- `alt` (required) - Alt text for accessibility
- `width` - Image width in pixels
- `height` - Image height in pixels

**Best practices:**
- Always use absolute URLs hosted on CDN
- Always include alt text
- Specify width and height to prevent layout shift
- Use `display: block` to avoid spacing issues

### Hr

Horizontal divider line.

```jsx
import { Hr } from '@react-email/components';

<Hr style={{ borderColor: '#e6e6e6', margin: '20px 0' }} />
```

## Specialized Components

### CodeBlock

Syntax-highlighted code blocks using Prism.js.

```jsx
import { CodeBlock, dracula } from '@react-email/components';

<CodeBlock
  code={`const greeting = "Hello World";
console.log(greeting);`}
  language="javascript"
  theme={dracula}
  lineNumbers
/>
```

**Props:**
- `code` (required) - Code string to display
- `language` (required) - Programming language (e.g., "javascript", "python", "typescript")
- `theme` - (required) Prism theme (dracula, github, etc.)
- `lineNumbers` - Boolean to show line numbers

**Available themes:**
Import from `@react-email/components`: dracula, github, nord, etc.

### CodeInline

Inline code within text.

```jsx
import { CodeInline } from '@react-email/components';

<Text>
  Run <CodeInline>npm install</CodeInline> to get started.
</Text>
```

### Markdown

Render Markdown content as HTML.

```jsx
import { Markdown } from '@react-email/components';

<Markdown
  markdownCustomStyles={{
    h1: { color: '#333', fontSize: '24px' },
    h2: { color: '#666', fontSize: '20px' },
    p: { fontSize: '16px', lineHeight: '24px' },
    a: { color: '#007bff' },
    code: { backgroundColor: '#f4f4f4', padding: '2px 4px' }
  }}
  markdownContainerStyles={{
    padding: '20px',
    backgroundColor: '#fff'
  }}
>
{`# Hello World

This is **bold** and this is *italic*.

- List item 1
- List item 2

[Link text](https://example.com)

\`inline code\`

\`\`\`javascript
const code = "block";
\`\`\`
`}
</Markdown>
```

**Props:**
- `children` (required) - Markdown string
- `markdownCustomStyles` - Style overrides for HTML elements
- `markdownContainerStyles` - Styles for container div

### Font

Custom web fonts.

```jsx
import { Font } from '@react-email/components';

<Head>
  <Font
    fontFamily="Roboto"
    fallbackFontFamily="Arial, sans-serif"
    webFont={{
      url: "https://fonts.gstatic.com/s/roboto/v27/KFOmCnqEu92Fr1Mu4mxKKTU1Kg.woff2",
      format: "woff2"
    }}
  />
</Head>
```

**Props:**
- `fontFamily` (required) - Font family name
- `fallbackFontFamily` - Fallback fonts
- `webFont` - Object with `url` and `format`

**Supported formats:**
- woff2 (recommended)
- woff
- truetype
- opentype

### Tailwind

Use Tailwind CSS utility classes.

```jsx
import { Tailwind, pixelBasedPreset } from '@react-email/components';

<Tailwind
  config={{
    presets: [pixelBasedPreset],
    theme: {
      extend: {
        colors: {
          brand: '#007bff',
          accent: '#28a745'
        },
        spacing: {
          '128': '32rem'
        }
      }
    }
  }}
>
  <Container className="max-w-2xl mx-auto p-4">
    <Heading className="text-2xl font-bold text-brand mb-4">
      Welcome!
    </Heading>
    <Text className="text-base text-gray-700 mb-4">
      Your content here.
    </Text>
    <Button className="bg-brand text-white px-6 py-3 rounded-lg">
      Get Started
    </Button>
  </Container>
</Tailwind>
```

**Props:**
- `config` - Tailwind configuration object

**How it works:**
- Tailwind classes are converted to inline styles automatically
- Media queries are extracted to `<style>` tag in `<head>`
- CSS variables are resolved
- RGB color syntax is normalized for email client compatibility

**Best practices:**
- Use with care as it can increase render times and bundle size significantly
- Wrap your entire email content in `<Tailwind>`
- Custom config is optional - defaults work well
- Responsive classes (sm:, md:, lg:) work via media queries, but should be used with caution due to limited email client support 

```

### references/I18N.md

```markdown
# Internationalization (i18n) Guide

Complete guide for implementing multi-language email support with React Email.

React Email officially supports three popular i18n libraries: next-intl, react-i18next, and react-intl.

## next-intl

Best choice for Next.js applications with straightforward API.

### Installation

```bash
npm install next-intl
```

### Setup

**1. Create message files:**

```json
// messages/en.json
{
  "welcome-email": {
    "subject": "Welcome to Acme",
    "greeting": "Hi",
    "body": "Thanks for signing up! We're excited to have you on board.",
    "cta": "Get Started",
    "footer": "If you have questions, reply to this email."
  }
}
```

```json
// messages/es.json
{
  "welcome-email": {
    "subject": "Bienvenido a Acme",
    "greeting": "Hola",
    "body": "¡Gracias por registrarte! Estamos emocionados de tenerte en la plataforma.",
    "cta": "Comenzar",
    "footer": "Si tienes preguntas, responde a este correo electrónico."
  }
}
```

```json
// messages/fr.json
{
  "welcome-email": {
    "subject": "Bienvenue chez Acme",
    "greeting": "Bonjour",
    "body": "Merci de vous être inscrit ! Nous sommes ravis de vous accueillir.",
    "cta": "Commencer",
    "footer": "Si vous avez des questions, répondez à cet e-mail."
  }
}
```

**2. Update email template:**

```tsx
import { createTranslator } from 'next-intl';
import {
  Html,
  Head,
  Preview,
  Body,
  Container,
  Heading,
  Text,
  Button,
  Hr
} from '@react-email/components';

interface WelcomeEmailProps {
  name: string;
  verificationUrl: string;
  locale: string;
}

export default async function WelcomeEmail({
  name,
  verificationUrl,
  locale
}: WelcomeEmailProps) {
  const t = createTranslator({
    messages: await import(`../messages/${locale}.json`),
    namespace: 'welcome-email',
    locale
  });

  return (
    <Html lang={locale}>
      <Head />
      <Preview>{t('subject')}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>{t('subject')}</Heading>
          <Text style={text}>{t('greeting')} {name},</Text>
          <Text style={text}>{t('body')}</Text>
          <Button href={verificationUrl} style={button}>
            {t('cta')}
          </Button>
          <Hr style={hr} />
          <Text style={footer}>{t('footer')}</Text>
        </Container>
      </Body>
    </Html>
  );
}

// Preview props
WelcomeEmail.PreviewProps = {
  name: 'John',
  verificationUrl: 'https://example.com/verify',
  locale: 'en'
} as WelcomeEmailProps;

// Styles
const main = { backgroundColor: '#f6f9fc', fontFamily: 'Arial, sans-serif' };
const container = { margin: '0 auto', padding: '40px 20px', maxWidth: '600px' };
const h1 = { fontSize: '24px', fontWeight: 'bold', color: '#333' };
const text = { fontSize: '16px', lineHeight: '26px', color: '#333', margin: '16px 0' };
const button = {
  backgroundColor: '#007bff',
  color: '#fff',
  padding: '12px 20px',
  borderRadius: '4px',
  textDecoration: 'none',
  textAlign: 'center' as const,
  display: 'block'
};
const hr = { borderColor: '#e6ebf1', margin: '20px 0' };
const footer = { fontSize: '14px', color: '#8898aa' };
```

**3. Send with locale:**

```tsx
await resend.emails.send({
  from: 'Acme <onboarding@resend.dev>',
  to: ['user@example.com'],
  subject: 'Welcome',
  react: <WelcomeEmail name="Jean" verificationUrl="..." locale="fr" />
});
```

## react-intl (FormatJS)

Good choice for complex formatting needs (plurals, dates, numbers).

### Installation

```bash
npm install react-intl
```

### Setup

**1. Create message files:**

```json
// messages/en/welcome-email.json
{
  "header": "Welcome to Acme",
  "greeting": "Hi",
  "body": "Thanks for signing up!",
  "cta": "Get Started",
  "itemCount": "{count, plural, one {# item} other {# items}}"
}
```

**2. Use in email:**

```tsx
import { createIntl } from 'react-intl';
import { Html, Body, Container, Text, Button } from '@react-email/components';

interface WelcomeEmailProps {
  name: string;
  locale: string;
  itemCount?: number;
}

export default async function WelcomeEmail({
  name,
  locale,
  itemCount = 1
}: WelcomeEmailProps) {
  const { formatMessage } = createIntl({
    locale,
    messages: await import(`../messages/${locale}/welcome-email.json`)
  });

  return (
    <Html lang={locale}>
      <Body>
        <Container>
          <Text>{formatMessage({ id: 'greeting' })} {name},</Text>
          <Text>{formatMessage({ id: 'body' })}</Text>
          <Text>
            {formatMessage({ id: 'itemCount' }, { count: itemCount })}
          </Text>
          <Button href="https://example.com">
            {formatMessage({ id: 'cta' })}
          </Button>
        </Container>
      </Body>
    </Html>
  );
}
```

## react-i18next

Best for non-Next.js applications or when you need more control.

### Installation

```bash
npm install react-i18next i18next i18next-resources-to-backend
```

### Setup

**1. Configure i18next:**

```js
// i18n.js
import i18next from 'i18next';
import resourcesToBackend from 'i18next-resources-to-backend';
import { initReactI18next } from 'react-i18next';

i18next
  .use(initReactI18next)
  .use(resourcesToBackend((language, namespace) =>
    import(`./messages/${language}/${namespace}.json`)
  ))
  .init({
    supportedLngs: ['en', 'es', 'fr', 'de'],
    fallbackLng: 'en',
    lng: undefined,
    preload: ['en', 'es', 'fr', 'de']
  });

export { i18next };
```

**2. Create translation helper:**

```js
// get-t.js
import { i18next } from './i18n';

export async function getT(namespace, locale) {
  if (locale && i18next.resolvedLanguage !== locale) {
    await i18next.changeLanguage(locale);
  }
  if (namespace && !i18next.hasLoadedNamespace(namespace)) {
    await i18next.loadNamespaces(namespace);
  }
  return {
    t: i18next.getFixedT(
      locale ?? i18next.resolvedLanguage,
      Array.isArray(namespace) ? namespace[0] : namespace
    ),
    i18n: i18next
  };
}
```

**3. Create message files:**

```json
// messages/en/welcome-email.json
{
  "subject": "Welcome to Acme",
  "greeting": "Hi",
  "body": "Thanks for signing up!",
  "cta": "Get Started"
}
```

```json
// messages/es/welcome-email.json
{
  "subject": "Bienvenido a Acme",
  "greeting": "Hola",
  "body": "¡Gracias por registrarte!",
  "cta": "Comenzar"
}
```

**4. Use in email template:**

```tsx
import { getT } from '../get-t';
import { Html, Body, Container, Heading, Text, Button } from '@react-email/components';

interface WelcomeEmailProps {
  name: string;
  locale: string;
}

export default async function WelcomeEmail({ name, locale }: WelcomeEmailProps) {
  const { t } = await getT('welcome-email', locale);

  return (
    <Html lang={locale}>
      <Body>
        <Container>
          <Heading>{t('subject')}</Heading>
          <Text>{t('greeting')} {name},</Text>
          <Text>{t('body')}</Text>
          <Button href="https://example.com">{t('cta')}</Button>
        </Container>
      </Body>
    </Html>
  );
}
```


## Message File Organization

### By Namespace (Recommended)

Organize translations by email template:

```
messages/
├── en.json          # All English translations
│   ├── welcome-email
│   ├── password-reset
│   └── order-confirmation
├── es.json          # All Spanish translations
└── fr.json          # All French translations
```

Or organize by template with separate files:

```
messages/
├── en/
│   ├── welcome-email.json
│   ├── password-reset.json
│   └── order-confirmation.json
├── es/
│   ├── welcome-email.json
│   ├── password-reset.json
│   └── order-confirmation.json
└── fr/
    ├── welcome-email.json
    ├── password-reset.json
    └── order-confirmation.json
```

### Translation Keys

Use descriptive, hierarchical keys:

```json
{
  "welcome-email": {
    "subject": "Welcome!",
    "preview": "Get started with your account",
    "header": {
      "title": "Welcome to Acme",
      "subtitle": "We're glad you're here"
    },
    "body": {
      "greeting": "Hi",
      "intro": "Thanks for signing up!",
      "next-steps": "Here's how to get started:"
    },
    "cta": {
      "primary": "Get Started",
      "secondary": "Learn More"
    },
    "footer": {
      "help": "Need help? Reply to this email",
      "unsubscribe": "Unsubscribe from these emails"
    }
  }
}
```

## Best Practices

### 1. Always Pass Locale

Make locale a required prop:

```tsx
interface EmailProps {
  locale: string;
  // other props...
}
```

### 2. Set HTML Lang Attribute

```tsx
<Html lang={locale}>
```

### 3. Support RTL Languages

For Arabic, Hebrew, etc.:

```tsx
const isRTL = ['ar', 'he', 'fa'].includes(locale);

<Html lang={locale} dir={isRTL ? 'rtl' : 'ltr'}>
```

### 4. Fallback Values

Provide fallback translations:

```tsx
const t = createTranslator({
  messages: await import(`../messages/${locale}.json`).catch(() =>
    import('../messages/en.json')
  ),
  locale,
  namespace: 'welcome-email'
});
```

### 5. Test All Locales

Test email rendering for each supported locale:

```tsx
WelcomeEmail.PreviewProps = {
  name: 'Test User',
  locale: 'en'  // Change to test different locales
} as WelcomeEmailProps;
```

### 6. Keep Keys Consistent

Use the same translation keys across all locale files:

```json
// ✅ Good
// en.json: { "cta": "Get Started" }
// es.json: { "cta": "Comenzar" }

// ❌ Bad
// en.json: { "button": "Get Started" }
// es.json: { "cta": "Comenzar" }
```

### 7. Handle Missing Translations

Set up fallback behavior:

```tsx
// With next-intl
const t = createTranslator({
  messages,
  locale,
  namespace: 'welcome-email',
  onError: (error) => {
    console.warn('Translation missing:', error);
  }
});
```

### 8. Subject Line Translation

Don't forget to translate email subjects:

```tsx
const t = createTranslator({...});

await resend.emails.send({
  from: 'Acme <onboarding@resend.dev>',
  to: [user.email],
  subject: t('subject'),  // ✅ Translated subject
  react: <WelcomeEmail {...props} />
});
```

### 9. Format Consistency

Maintain consistent formatting across locales:
- Date formats (MM/DD/YYYY vs DD/MM/YYYY)
- Time formats (12h vs 24h)
- Number separators (1,234.56 vs 1.234,56)
- Currency symbols and placement ($100 vs 100$)

Use `Intl` APIs for automatic locale-specific formatting.

## Example: Complete Multi-locale Email

```tsx
import { createTranslator } from 'next-intl';
import {
  Html,
  Head,
  Preview,
  Body,
  Container,
  Section,
  Heading,
  Text,
  Button,
  Hr
} from '@react-email/components';

interface OrderConfirmationProps {
  orderNumber: string;
  total: number;
  currency: string;
  locale: string;
  orderDate: Date;
}

export default async function OrderConfirmation({
  orderNumber,
  total,
  currency,
  locale,
  orderDate
}: OrderConfirmationProps) {
  const t = createTranslator({
    messages: await import(`../messages/${locale}.json`),
    namespace: 'order-confirmation',
    locale
  });

  const isRTL = ['ar', 'he'].includes(locale);

  const currencyFormatter = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency
  });

  const dateFormatter = new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  return (
    <Html lang={locale} dir={isRTL ? 'rtl' : 'ltr'}>
      <Head />
      <Preview>{t('preview')}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>{t('title')}</Heading>
          <Text style={text}>
            {t('order-number')}: {orderNumber}
          </Text>
          <Text style={text}>
            {t('order-date')}: {dateFormatter.format(orderDate)}
          </Text>
          <Section style={section}>
            <Text style={totalText}>
              {t('total')}: {currencyFormatter.format(total)}
            </Text>
          </Section>
          <Button href={`https://example.com/orders/${orderNumber}`} style={button}>
            {t('view-order')}
          </Button>
          <Hr style={hr} />
          <Text style={footer}>{t('footer')}</Text>
        </Container>
      </Body>
    </Html>
  );
}

const main = { backgroundColor: '#f6f9fc', fontFamily: 'Arial, sans-serif' };
const container = { margin: '0 auto', padding: '40px 20px', maxWidth: '600px' };
const h1 = { fontSize: '24px', fontWeight: 'bold', color: '#333' };
const text = { fontSize: '16px', color: '#333', margin: '8px 0' };
const section = { backgroundColor: '#fff', padding: '20px', borderRadius: '4px' };
const totalText = { fontSize: '20px', fontWeight: 'bold', color: '#333' };
const button = {
  backgroundColor: '#007bff',
  color: '#fff',
  padding: '12px 20px',
  borderRadius: '4px',
  textDecoration: 'none',
  textAlign: 'center' as const,
  display: 'block',
  margin: '20px 0'
};
const hr = { borderColor: '#e6ebf1', margin: '20px 0' };
const footer = { fontSize: '14px', color: '#8898aa' };
```

With message files:

```json
// messages/en.json
{
  "order-confirmation": {
    "preview": "Your order has been confirmed",
    "title": "Order Confirmed",
    "order-number": "Order number",
    "order-date": "Order date",
    "total": "Total",
    "view-order": "View Order",
    "footer": "Thank you for your purchase!"
  }
}
```

```json
// messages/es.json
{
  "order-confirmation": {
    "preview": "Tu pedido ha sido confirmado",
    "title": "Pedido Confirmado",
    "order-number": "Número de pedido",
    "order-date": "Fecha del pedido",
    "total": "Total",
    "view-order": "Ver Pedido",
    "footer": "¡Gracias por tu compra!"
  }
}
```

```

### references/PATTERNS.md

```markdown
# Common Email Patterns

Real-world examples of common email templates using React Email.

## Password Reset Email

```tsx
import { Html, Head, Preview, Body, Container, Heading, Text, Button, Hr } from '@react-email/components';

interface PasswordResetProps {
  resetUrl: string;
  email: string;
  expiryHours?: number;
}

export default function PasswordReset({ resetUrl, email, expiryHours = 1 }: PasswordResetProps) {
  return (
    <Html lang="en">
      <Head />
      <Preview>Reset your password - Action required</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>Reset Your Password</Heading>
          <Text style={text}>
            A password reset was requested for your account: <strong>{email}</strong>
          </Text>
          <Text style={text}>
            Click the button below to reset your password. This link expires in {expiryHours} hour{expiryHours > 1 ? 's' : ''}.
          </Text>
          <Button href={resetUrl} style={button}>
            Reset Password
          </Button>
          <Hr style={hr} />
          <Text style={footer}>
            If you didn't request this, please ignore this email. Your password will remain unchanged.
          </Text>
          <Text style={footer}>
            For security, this link will only work once.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

PasswordReset.PreviewProps = {
  resetUrl: 'https://example.com/reset/abc123',
  email: 'user@example.com',
  expiryHours: 1
} as PasswordResetProps;

const main = { backgroundColor: '#f6f9fc', fontFamily: 'Arial, sans-serif' };
const container = { margin: '0 auto', padding: '40px 20px', maxWidth: '560px', backgroundColor: '#ffffff' };
const h1 = { fontSize: '24px', fontWeight: 'bold', color: '#333', marginBottom: '20px' };
const text = { fontSize: '16px', lineHeight: '26px', color: '#333', margin: '16px 0' };
const button = {
  backgroundColor: '#dc3545',
  color: '#fff',
  padding: '14px 28px',
  borderRadius: '4px',
  textDecoration: 'none',
  textAlign: 'center' as const,
  display: 'block',
  fontWeight: 'bold',
  margin: '24px 0'
};
const hr = { borderColor: '#e6ebf1', margin: '24px 0' };
const footer = { fontSize: '14px', color: '#8898aa', lineHeight: '20px', margin: '8px 0' };
```

## Order Confirmation with Product List

```tsx
import { 
  Html, Head, Preview, Body, Container, Section, Row, Column, 
  Heading, Text, Img, Hr 
} from '@react-email/components';

interface Product {
  name: string;
  price: number;
  quantity: number;
  image: string;
  sku?: string;
}

interface OrderConfirmationProps {
  orderNumber: string;
  orderDate: Date;
  items: Product[];
  subtotal: number;
  shipping: number;
  tax: number;
  total: number;
  shippingAddress: {
    name: string;
    street: string;
    city: string;
    state: string;
    zip: string;
    country: string;
  };
}

export default function OrderConfirmation({
  orderNumber,
  orderDate,
  items,
  subtotal,
  shipping,
  tax,
  total,
  shippingAddress
}: OrderConfirmationProps) {
  return (
    <Html lang="en">
      <Head />
      <Preview>Order #{orderNumber} confirmed - Thank you for your purchase!</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>Order Confirmed</Heading>
          <Text style={text}>Thank you for your order!</Text>
          
          <Section style={infoSection}>
            <Row>
              <Column>
                <Text style={label}>Order Number</Text>
                <Text style={value}>#{orderNumber}</Text>
              </Column>
              <Column>
                <Text style={label}>Order Date</Text>
                <Text style={value}>{orderDate.toLocaleDateString()}</Text>
              </Column>
            </Row>
          </Section>

          <Hr style={hr} />

          <Heading as="h2" style={h2}>Order Items</Heading>
          
          {items.map((item, index) => (
            <Section key={index} style={productSection}>
              <Row>
                <Column style={{ width: '80px', verticalAlign: 'top' }}>
                  <Img 
                    src={item.image} 
                    alt={item.name}
                    width="80" 
                    height="80"
                    style={productImage}
                  />
                </Column>
                <Column style={{ verticalAlign: 'top', paddingLeft: '16px' }}>
                  <Text style={productName}>{item.name}</Text>
                  {item.sku && <Text style={productSku}>SKU: {item.sku}</Text>}
                  <Text style={productDetails}>
                    Quantity: {item.quantity} × ${item.price.toFixed(2)}
                  </Text>
                </Column>
                <Column style={{ width: '100px', textAlign: 'right', verticalAlign: 'top' }}>
                  <Text style={productPrice}>
                    ${(item.quantity * item.price).toFixed(2)}
                  </Text>
                </Column>
              </Row>
            </Section>
          ))}

          <Hr style={hr} />

          <Section style={totalsSection}>
            <Row>
              <Column><Text style={totalsLabel}>Subtotal</Text></Column>
              <Column style={{ textAlign: 'right' }}>
                <Text style={totalsValue}>${subtotal.toFixed(2)}</Text>
              </Column>
            </Row>
            <Row>
              <Column><Text style={totalsLabel}>Shipping</Text></Column>
              <Column style={{ textAlign: 'right' }}>
                <Text style={totalsValue}>${shipping.toFixed(2)}</Text>
              </Column>
            </Row>
            <Row>
              <Column><Text style={totalsLabel}>Tax</Text></Column>
              <Column style={{ textAlign: 'right' }}>
                <Text style={totalsValue}>${tax.toFixed(2)}</Text>
              </Column>
            </Row>
            <Hr style={thinHr} />
            <Row>
              <Column><Text style={totalLabel}>Total</Text></Column>
              <Column style={{ textAlign: 'right' }}>
                <Text style={totalValue}>${total.toFixed(2)}</Text>
              </Column>
            </Row>
          </Section>

          <Hr style={hr} />

          <Heading as="h2" style={h2}>Shipping Address</Heading>
          <Section style={addressSection}>
            <Text style={addressText}>{shippingAddress.name}</Text>
            <Text style={addressText}>{shippingAddress.street}</Text>
            <Text style={addressText}>
              {shippingAddress.city}, {shippingAddress.state} {shippingAddress.zip}
            </Text>
            <Text style={addressText}>{shippingAddress.country}</Text>
          </Section>

          <Text style={footer}>
            Questions about your order? Reply to this email and we'll help you out.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

OrderConfirmation.PreviewProps = {
  orderNumber: '10234',
  orderDate: new Date(),
  items: [
    {
      name: 'Vintage Macintosh',
      price: 499.00,
      quantity: 1,
      image: 'https://via.placeholder.com/80',
      sku: 'MAC-001'
    },
    {
      name: 'Mechanical Keyboard',
      price: 149.99,
      quantity: 2,
      image: 'https://via.placeholder.com/80',
      sku: 'KEY-042'
    }
  ],
  subtotal: 798.98,
  shipping: 15.00,
  tax: 69.42,
  total: 883.40,
  shippingAddress: {
    name: 'John Doe',
    street: '123 Main St',
    city: 'San Francisco',
    state: 'CA',
    zip: '94102',
    country: 'USA'
  }
} as OrderConfirmationProps;

const main = { backgroundColor: '#f6f9fc', fontFamily: 'Arial, sans-serif' };
const container = { margin: '0 auto', padding: '40px 20px', maxWidth: '600px' };
const h1 = { fontSize: '28px', fontWeight: 'bold', color: '#333', marginBottom: '8px' };
const h2 = { fontSize: '20px', fontWeight: 'bold', color: '#333', margin: '24px 0 16px 0' };
const text = { fontSize: '16px', color: '#666', marginBottom: '24px' };
const infoSection = { backgroundColor: '#f8f9fa', padding: '16px', borderRadius: '4px', marginBottom: '24px' };
const label = { fontSize: '12px', color: '#666', textTransform: 'uppercase' as const, marginBottom: '4px' };
const value = { fontSize: '16px', fontWeight: 'bold', color: '#333', margin: '0' };
const hr = { borderColor: '#e6ebf1', margin: '24px 0' };
const thinHr = { borderColor: '#e6ebf1', margin: '12px 0' };
const productSection = { marginBottom: '16px' };
const productImage = { borderRadius: '4px', border: '1px solid #e6ebf1' };
const productName = { fontSize: '16px', fontWeight: 'bold', color: '#333', margin: '0 0 4px 0' };
const productSku = { fontSize: '14px', color: '#999', margin: '0 0 8px 0' };
const productDetails = { fontSize: '14px', color: '#666', margin: '0' };
const productPrice = { fontSize: '16px', fontWeight: 'bold', color: '#333', margin: '0' };
const totalsSection = { marginTop: '24px' };
const totalsLabel = { fontSize: '14px', color: '#666', margin: '8px 0' };
const totalsValue = { fontSize: '14px', color: '#333', margin: '8px 0' };
const totalLabel = { fontSize: '18px', fontWeight: 'bold', color: '#333', margin: '8px 0' };
const totalValue = { fontSize: '18px', fontWeight: 'bold', color: '#333', margin: '8px 0' };
const addressSection = { backgroundColor: '#f8f9fa', padding: '16px', borderRadius: '4px' };
const addressText = { fontSize: '14px', color: '#333', margin: '4px 0' };
const footer = { fontSize: '14px', color: '#8898aa', marginTop: '32px' };
```

## Notification Email with Code Block

```tsx
import { 
  Html, Head, Preview, Body, Container, Heading, Text, 
  CodeBlock, dracula, Hr, Link 
} from '@react-email/components';

interface NotificationProps {
  title: string;
  message: string;
  severity: 'info' | 'warning' | 'error' | 'success';
  timestamp: Date;
  logData?: string;
  actionUrl?: string;
  actionLabel?: string;
}

export default function Notification({
  title,
  message,
  severity,
  timestamp,
  logData,
  actionUrl,
  actionLabel = 'View Details'
}: NotificationProps) {
  const severityColors = {
    info: '#0ea5e9',
    warning: '#f59e0b',
    error: '#ef4444',
    success: '#22c55e'
  };

  const severityColor = severityColors[severity];

  return (
    <Html lang="en">
      <Head />
      <Preview>{title} - {severity}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Section style={{ ...statusBar, backgroundColor: severityColor }} />
          
          <Heading style={h1}>{title}</Heading>
          
          <Text style={{ ...badge, backgroundColor: severityColor }}>
            {severity.toUpperCase()}
          </Text>
          
          <Text style={text}>{message}</Text>
          
          <Text style={timestamp}>
            {new Date(timestamp).toLocaleString('en-US', {
              dateStyle: 'long',
              timeStyle: 'short'
            })}
          </Text>

          {logData && (
            <>
              <Hr style={hr} />
              <Heading as="h2" style={h2}>Log Details</Heading>
              <CodeBlock
                code={logData}
                language="json"
                theme={dracula}
                lineNumbers
                style={codeBlock}
              />
            </>
          )}

          {actionUrl && (
            <>
              <Hr style={hr} />
              <Link href={actionUrl} style={{ ...button, backgroundColor: severityColor }}>
                {actionLabel}
              </Link>
            </>
          )}

          <Hr style={hr} />
          <Text style={footer}>
            This is an automated notification. Please do not reply to this email.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

Notification.PreviewProps = {
  title: 'Deployment Failed',
  message: 'The deployment to production environment has failed. Please review the logs and take corrective action.',
  severity: 'error',
  timestamp: new Date(),
  logData: `{
  "error": "Build failed",
  "exit_code": 1,
  "duration": "2m 34s",
  "commit": "abc123def"
}`,
  actionUrl: 'https://example.com/deployments/123',
  actionLabel: 'View Deployment'
} as NotificationProps;

const main = { backgroundColor: '#f6f9fc', fontFamily: 'monospace, Arial, sans-serif' };
const container = { 
  margin: '0 auto', 
  padding: '0',
  maxWidth: '600px',
  backgroundColor: '#ffffff',
  border: '1px solid #e6ebf1',
  borderRadius: '4px',
  overflow: 'hidden'
};
const statusBar = { height: '4px', width: '100%' };
const h1 = { fontSize: '24px', fontWeight: 'bold', color: '#333', margin: '24px 24px 16px 24px' };
const h2 = { fontSize: '18px', fontWeight: 'bold', color: '#333', margin: '16px 24px' };
const badge = {
  display: 'inline-block',
  padding: '4px 12px',
  fontSize: '12px',
  fontWeight: 'bold',
  color: '#fff',
  borderRadius: '12px',
  marginLeft: '24px',
  marginBottom: '16px'
};
const text = { fontSize: '16px', lineHeight: '24px', color: '#333', margin: '0 24px 16px 24px' };
const timestamp = { fontSize: '14px', color: '#666', margin: '0 24px 24px 24px' };
const hr = { borderColor: '#e6ebf1', margin: '24px 0' };
const codeBlock = { margin: '0 24px' };
const button = {
  display: 'inline-block',
  padding: '12px 24px',
  fontSize: '16px',
  fontWeight: 'bold',
  color: '#fff',
  textDecoration: 'none',
  borderRadius: '4px',
  margin: '0 24px 24px 24px'
};
const footer = { fontSize: '12px', color: '#8898aa', margin: '0 24px 24px 24px' };

// Need to define Section for this example
const Section = ({ children, style }: { children?: React.ReactNode; style?: React.CSSProperties }) => (
  <div style={style}>{children}</div>
);
```

## Multi-Column Newsletter

```tsx
import { 
  Html, Head, Preview, Body, Container, Section, Row, Column, 
  Heading, Text, Img, Button, Hr, Link 
} from '@react-email/components';

interface Article {
  title: string;
  excerpt: string;
  image: string;
  url: string;
  author: string;
  date: string;
}

interface NewsletterProps {
  articles: Article[];
  unsubscribeUrl: string;
}

export default function Newsletter({ articles, unsubscribeUrl }: NewsletterProps) {
  return (
    <Html lang="en">
      <Head />
      <Preview>Your weekly roundup of the latest articles</Preview>
      <Body style={main}>
        <Container style={container}>
          {/* Header */}
          <Section style={header}>
            <Img 
              src="https://via.placeholder.com/150x50?text=Logo" 
              alt="Company Logo"
              width="150"
              height="50"
            />
          </Section>

          <Heading style={h1}>This Week's Highlights</Heading>
          <Text style={intro}>
            Here are the top articles from this week. Enjoy your reading!
          </Text>

          <Hr style={hr} />

          {/* Featured Article */}
          {articles[0] && (
            <Section style={featuredSection}>
              <Img 
                src={articles[0].image} 
                alt={articles[0].title}
                width="600"
                style={featuredImage}
              />
              <Heading as="h2" style={h2}>{articles[0].title}</Heading>
              <Text style={excerpt}>{articles[0].excerpt}</Text>
              <Text style={meta}>
                By {articles[0].author} • {articles[0].date}
              </Text>
              <Button href={articles[0].url} style={button}>
                Read More
              </Button>
            </Section>
          )}

          <Hr style={hr} />

          {/* Two-Column Articles */}
          {articles.slice(1, 5).length > 0 && (
            <>
              <Heading as="h2" style={h2}>More From This Week</Heading>
              {Array.from({ length: Math.ceil(articles.slice(1, 5).length / 2) }).map((_, rowIndex) => {
                const leftArticle = articles[1 + rowIndex * 2];
                const rightArticle = articles[2 + rowIndex * 2];
                
                return (
                  <Section key={rowIndex} style={articleRow}>
                    <Row>
                      {leftArticle && (
                        <Column style={articleColumn}>
                          <Img 
                            src={leftArticle.image} 
                            alt={leftArticle.title}
                            width="280"
                            style={articleImage}
                          />
                          <Heading as="h3" style={h3}>{leftArticle.title}</Heading>
                          <Text style={articleExcerpt}>{leftArticle.excerpt}</Text>
                          <Link href={leftArticle.url} style={link}>
                            Read article →
                          </Link>
                        </Column>
                      )}
                      
                      {rightArticle && (
                        <Column style={articleColumn}>
                          <Img 
                            src={rightArticle.image} 
                            alt={rightArticle.title}
                            width="280"
                            style={articleImage}
                          />
                          <Heading as="h3" style={h3}>{rightArticle.title}</Heading>
                          <Text style={articleExcerpt}>{rightArticle.excerpt}</Text>
                          <Link href={rightArticle.url} style={link}>
                            Read article →
                          </Link>
                        </Column>
                      )}
                    </Row>
                  </Section>
                );
              })}
            </>
          )}

          <Hr style={hr} />

          {/* Footer */}
          <Section style={footer}>
            <Text style={footerText}>
              You're receiving this because you subscribed to our newsletter.
            </Text>
            <Link href={unsubscribeUrl} style={unsubscribeLink}>
              Unsubscribe from this list
            </Link>
            <Text style={footerText}>
              © 2026 Company Name. All rights reserved.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

Newsletter.PreviewProps = {
  articles: [
    {
      title: 'The Future of Web Development in 2026',
      excerpt: 'Exploring the latest trends and technologies shaping modern web development.',
      image: 'https://via.placeholder.com/600x300',
      url: 'https://example.com/article-1',
      author: 'Jane Doe',
      date: 'Jan 15, 2026'
    },
    {
      title: 'React Server Components Explained',
      excerpt: 'A deep dive into React Server Components and their benefits.',
      image: 'https://via.placeholder.com/280x140',
      url: 'https://example.com/article-2',
      author: 'John Smith',
      date: 'Jan 14, 2026'
    },
    {
      title: 'Building Accessible Web Apps',
      excerpt: 'Best practices for creating inclusive digital experiences.',
      image: 'https://via.placeholder.com/280x140',
      url: 'https://example.com/article-3',
      author: 'Sarah Johnson',
      date: 'Jan 13, 2026'
    }
  ],
  unsubscribeUrl: 'https://example.com/unsubscribe'
} as NewsletterProps;

const main = { backgroundColor: '#ffffff', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' };
const container = { margin: '0 auto', maxWidth: '600px' };
const header = { padding: '40px 20px 20px 20px', textAlign: 'center' as const };
const h1 = { fontSize: '32px', fontWeight: 'bold', color: '#1a1a1a', margin: '0 20px 16px 20px', textAlign: 'center' as const };
const h2 = { fontSize: '24px', fontWeight: 'bold', color: '#1a1a1a', margin: '32px 20px 16px 20px' };
const h3 = { fontSize: '18px', fontWeight: 'bold', color: '#1a1a1a', margin: '12px 0 8px 0' };
const intro = { fontSize: '16px', lineHeight: '24px', color: '#666', margin: '0 20px 24px 20px', textAlign: 'center' as const };
const hr = { borderColor: '#e6ebf1', margin: '32px 20px' };
const featuredSection = { padding: '0 20px' };
const featuredImage = { width: '100%', borderRadius: '8px', marginBottom: '16px' };
const excerpt = { fontSize: '16px', lineHeight: '24px', color: '#666', margin: '16px 0' };
const meta = { fontSize: '14px', color: '#999', margin: '8px 0 16px 0' };
const button = {
  backgroundColor: '#007bff',
  color: '#fff',
  padding: '12px 24px',
  borderRadius: '4px',
  textDecoration: 'none',
  display: 'inline-block',
  fontWeight: 'bold'
};
const articleRow = { padding: '0 20px', marginBottom: '24px' };
const articleColumn = { width: '48%', verticalAlign: 'top' as const, padding: '0 1%' };
const articleImage = { width: '100%', borderRadius: '4px', marginBottom: '12px' };
const articleExcerpt = { fontSize: '14px', lineHeight: '20px', color: '#666', margin: '8px 0' };
const link = { fontSize: '14px', color: '#007bff', textDecoration: 'none', fontWeight: '600' };
const footer = { backgroundColor: '#f8f9fa', padding: '32px 20px', marginTop: '32px', textAlign: 'center' as const };
const footerText = { fontSize: '14px', color: '#666', margin: '8px 0' };
const unsubscribeLink = { fontSize: '14px', color: '#007bff', textDecoration: 'underline', margin: '8px 0', display: 'block' };
```

## Team Invitation Email

```tsx
import { Html, Head, Preview, Body, Container, Heading, Text, Button, Hr } from '@react-email/components';

interface TeamInvitationProps {
  inviterName: string;
  inviterEmail: string;
  teamName: string;
  role: string;
  inviteUrl: string;
  expiryDays: number;
}

export default function TeamInvitation({
  inviterName,
  inviterEmail,
  teamName,
  role,
  inviteUrl,
  expiryDays
}: TeamInvitationProps) {
  return (
    <Html lang="en">
      <Head />
      <Preview>You've been invited to join {teamName}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>You're Invited!</Heading>
          
          <Text style={text}>
            <strong>{inviterName}</strong> ({inviterEmail}) has invited you to join the{' '}
            <strong>{teamName}</strong> team.
          </Text>

          <Section style={infoBox}>
            <Text style={infoLabel}>Role</Text>
            <Text style={infoValue}>{role}</Text>
          </Section>

          <Text style={text}>
            Click the button below to accept the invitation and get started.
          </Text>

          <Button href={inviteUrl} style={button}>
            Accept Invitation
          </Button>

          <Hr style={hr} />

          <Text style={footer}>
            This invitation will expire in {expiryDays} day{expiryDays > 1 ? 's' : ''}.
          </Text>
          <Text style={footer}>
            If you weren't expecting this invitation, you can safely ignore this email.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

TeamInvitation.PreviewProps = {
  inviterName: 'John Doe',
  inviterEmail: 'john@example.com',
  teamName: 'Acme Corp Engineering',
  role: 'Developer',
  inviteUrl: 'https://example.com/invite/abc123',
  expiryDays: 7
} as TeamInvitationProps;

const main = { backgroundColor: '#f6f9fc', fontFamily: 'Arial, sans-serif' };
const container = { margin: '0 auto', padding: '40px 20px', maxWidth: '560px', backgroundColor: '#ffffff' };
const h1 = { fontSize: '28px', fontWeight: 'bold', color: '#333', textAlign: 'center' as const, marginBottom: '24px' };
const text = { fontSize: '16px', lineHeight: '26px', color: '#333', margin: '16px 0' };
const infoBox = { 
  backgroundColor: '#f8f9fa', 
  padding: '20px', 
  borderRadius: '4px', 
  border: '1px solid #e6ebf1',
  margin: '24px 0'
};
const infoLabel = { 
  fontSize: '12px', 
  color: '#666', 
  textTransform: 'uppercase' as const,
  fontWeight: 'bold',
  marginBottom: '8px'
};
const infoValue = { fontSize: '18px', color: '#333', fontWeight: 'bold', margin: '0' };
const button = {
  backgroundColor: '#28a745',
  color: '#fff',
  padding: '14px 28px',
  borderRadius: '4px',
  textDecoration: 'none',
  textAlign: 'center' as const,
  display: 'block',
  fontWeight: 'bold',
  fontSize: '16px',
  margin: '24px 0'
};
const hr = { borderColor: '#e6ebf1', margin: '24px 0' };
const footer = { fontSize: '14px', color: '#8898aa', lineHeight: '20px', margin: '8px 0' };

// Define Section for this example
const Section = ({ children, style }: { children?: React.ReactNode; style?: React.CSSProperties }) => (
  <div style={style}>{children}</div>
);
```

These patterns demonstrate:
- Proper component usage
- TypeScript typing
- Inline styling
- Preview props for testing
- Responsive layouts
- Common email scenarios

```

