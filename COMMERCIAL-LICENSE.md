# Licensing Mizan

Mizan is **dual-licensed**.

| You want to… | Licence | Cost |
|---|---|---|
| Use Mizan yourself, at home or at work, unchanged or modified | [AGPL-3.0-or-later](LICENSE) | Free |
| Run Mizan for your team (one person hosts a workspace for others) | AGPL-3.0-or-later | Free |
| Fork it, change it and share your changes under the AGPL | AGPL-3.0-or-later | Free |
| Ship Mizan, or a product built on its code, **without** releasing your source code (closed-source app, white-label, embedded in a proprietary product, hosted service whose changes you keep private) | Commercial licence | Paid, by agreement |
| Get guaranteed support, priority fixes or help with deployment | Support contract (separate from the licence) | Paid |

## What the AGPL asks of you

The AGPL is a free-software licence. Using Mizan never costs anything and you don't have to tell anyone. The obligations only apply when you **share** Mizan with others:

- **Distributing** it (an installer, an APK, a modified build): give recipients the corresponding source code under the AGPL.
- **Letting people use a modified version over a network**, for example a team host you changed: offer those users the source of your modified version (AGPL §13).
- **Keeping notices**: leave the copyright and licence notices in place, and mark your changes.

Running an **unmodified** Mizan, including hosting team workspaces for colleagues, requires nothing beyond keeping the notices. The source is already public.

## The commercial licence

The copyright holder can grant the same code under different terms. This is possible because every contribution is made under the [CLA](CLA.md). A commercial licence typically covers:

- distributing modified or unmodified Mizan without the AGPL source-sharing obligations;
- using Mizan code inside a proprietary product;
- removing or changing the Mizan branding (see [TRADEMARKS.md](TRADEMARKS.md));
- optionally, a warranty, indemnity and support terms, which the AGPL does not provide.

Pricing is per organisation and per product. Contact: **licensing@<your-domain>** (maintainer: replace before publishing).

## Third-party components

Every bundled dependency uses a permissive or weak-copyleft licence (MIT, Apache-2.0, BSD, ISC, Zlib, Unicode, MPL-2.0, OFL-1.1). None of them stops proprietary redistribution under a commercial licence. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Two exceptions are worth knowing about:

- **Android `play` flavour**: links Google's proprietary *play-services-code-scanner* for QR scanning. The copyright holder grants the permission below for it. The `foss` flavour contains no proprietary code.
- **MPL-2.0 crates** (`cssparser`, `selectors`, `dtoa-short`, `option-ext`): if you modify one of these files, publish your changes to that file. Using them unchanged needs nothing.

### Additional permission (AGPL §7)

> As an additional permission under section 7 of the GNU AGPL version 3, you may link the Android
> companion ("play" product flavour) with the Google Play services code-scanner library and
> distribute the result. You must still follow the AGPL for all of Mizan's own code. If you modify
> Mizan, you may extend this exception to your version, but you are not required to.

## Changing the licence later

- **Future versions**: the copyright holder can change the licence of future releases, for example to a more permissive or a source-available one, because contributions are covered by the CLA.
- **Past releases**: they stay available under the licence they were published with. Anyone who already has an AGPL copy keeps their AGPL rights to it forever.
- **Before the first public release**, anything can still change: the licence, the name and the CLA.
