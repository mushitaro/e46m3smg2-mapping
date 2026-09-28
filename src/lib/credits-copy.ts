/**
 * The words in CREDITS. Named sources first — what each work was, then what in this app rests on
 * it, both halves and no deeper (tsunagi-m-chrome §4) — and the colophon last.
 *
 * Every entry is taken from THIRD-PARTY-NOTICES.md §2, which is where the provenance of each input
 * is decided and written down. Change that file first; this one follows it.
 */

import type { Lang } from './i18n';

export interface CreditEntry {
    who: string;
    what: string;
    /** A public page to follow, where there is one. */
    url?: string;
}

export const CREDITS_COPY: Record<
    Lang,
    {
        title: string;
        close: string;
        intro: string;
        entries: CreditEntry[];
        notices: string;
        build: string;
        meshLead: string;
        meshTail: string;
        supportersLead: string;
        supportersOthers: string;
        supportersAsOf: (date: string) => string;
    }
> = {
    ja: {
        title: 'CREDITS — 出典',
        close: '閉じる',
        intro:
            '本ツールは、先に公開してくださった方々の仕事と、BMW の資料の上に成り立っています。以下に、その仕事と、本アプリのどこがそれに拠っているかを記します。',
        entries: [
            {
                who: 'MS4X Dev Team',
                what:
                    'SMG II 510 較正の TunerPro 定義（XDF、Olza さんの提供）。本アプリが較正を読み解く項目・アドレス・スケーリングは、これに拠っています。本プロジェクトの訂正は、その上に重ねたものです（src/lib/smg2-catalog）。',
            },
            {
                who: 'BMW SP-DATEN',
                what:
                    'SMG II の純正プログラミングデータ。本アプリの「純正（STOCK）」との比較は、その 4 つのデータファイルを基準にしています。ファイルそのものは再配布していません。',
            },
            {
                who: 'BMW EDIABAS SGBD（SMG2.prg）',
                what:
                    'SMG II と話すためのジョブ定義。docs/smg2-write-protocol.md に記した書き込みの電文は、ここから書き写した定数に拠っています。',
            },
        ],
        notices: 'ライセンスと出所の全文は THIRD-PARTY-NOTICES.md にあります。',
        build: 'ビルド',
        meshLead: '本ツールは TSUNAGI のコミュニティに繋がっています。研究の続きと、支えてくださる方々の一覧は',
        meshTail: 'に。',
        supportersLead: 'このツールを支えてくださっている方々',
        supportersOthers: 'ほか、名前を出さずに支えてくださっている方々',
        supportersAsOf: (date) => `${date} 時点・MILE の多い順`,
    },
    en: {
        title: 'CREDITS',
        close: 'Close',
        intro:
            'This tool is built on work others published first, and on BMW’s own data. Each entry below names that work, and what in this application rests on it.',
        entries: [
            {
                who: 'MS4X Dev Team',
                what:
                    'The TunerPro definitions of the SMG II 510 calibration (XDF, supplied by Olza). The items, addresses and scalings this application decodes the calibration with rest on them; this project’s corrections are layered on top (src/lib/smg2-catalog).',
            },
            {
                who: 'BMW SP-DATEN',
                what:
                    'BMW’s programming data for the SMG II. The comparison with STOCK in this application is made against its four data files, which are not redistributed.',
            },
            {
                who: 'BMW EDIABAS SGBD (SMG2.prg)',
                what:
                    'BMW’s job definitions for talking to the SMG II. The write telegrams in docs/smg2-write-protocol.md rest on constants transcribed from it.',
            },
        ],
        notices: 'The full licence and provenance position is in THIRD-PARTY-NOTICES.md.',
        build: 'Build',
        meshLead: 'This tool is part of the TSUNAGI community. The research continues, and the people who carry it are listed, at',
        meshTail: '.',
        supportersLead: 'Carried by',
        supportersOthers: '…and others who chose not to be named',
        supportersAsOf: (date) => `As of ${date}, most MILE first`,
    },
};
