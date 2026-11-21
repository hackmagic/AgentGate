import { defineConfig } from 'vitepress';

/**
 * Documentation site configuration.
 *
 * Chinese is the source language, so it is mounted at the site root and English
 * lives under `/en/`. That ordering is deliberate: the default locale is the
 * one an author edits first, and a site whose default locale is a translation
 * invites edits in the wrong tree.
 *
 * The repository's public face (README) stays English, because GitHub visitors
 * read that first. A docs site and a repository home page have different
 * audiences, and this configuration only governs the former.
 */
export default defineConfig({
  title: 'AgentGate',
  description: '把「AI 什么时候可以介入我电脑操作」写成可执行、可审计的边界策略。',
  lang: 'zh-CN',
  cleanUrls: true,
  lastUpdated: true,

  // Pages are authored in `docs/<lang>/`, which is also the VitePress source
  // root, so no extra `srcDir` mapping is needed beyond the language split.
  srcDir: '.',

  head: [
    ['meta', { name: 'theme-color', content: '#2f6feb' }],
    ['meta', { property: 'og:type', content: 'website' }],
  ],

  themeConfig: {
    outline: { level: [2, 3] },
    search: { provider: 'local' },

    // Framework strings are configured here rather than written into page
    // bodies, so switching them is one edit and translators never touch them.
    nav: [
      { text: '概览', link: '/00-project-brief' },
      { text: '架构', link: '/02-architecture' },
      { text: '策略 DSL', link: '/04-policy-dsl' },
      { text: '参考', link: '/10-report-spec' },
    ],

    sidebar: {
      '/': [
        {
          text: '开始',
          items: [
            { text: '文档索引', link: '/README' },
            { text: '一页纸立项', link: '/00-project-brief' },
            { text: '产品需求', link: '/01-prd' },
          ],
        },
        {
          text: '架构与生命周期',
          items: [
            { text: '运行时架构', link: '/02-architecture' },
            { text: '策略生命周期', link: '/03-policy-lifecycle' },
          ],
        },
        {
          text: '参考',
          items: [
            { text: '策略 DSL', link: '/04-policy-dsl' },
            { text: '行为事件', link: '/05-event-spec' },
            { text: '编译器', link: '/06-compiler-spec' },
            { text: '具身交互', link: '/07-pet-bridge' },
            { text: '安全与审计', link: '/08-security-and-audit' },
            { text: '报告规范', link: '/10-report-spec' },
            { text: '术语表', link: '/glossary' },
          ],
        },
        {
          text: '项目',
          items: [
            { text: '路线图', link: '/09-mvp-roadmap' },
            { text: '参与翻译', link: '/contributing/translations' },
          ],
        },
      ],
      '/en/': [
        {
          text: 'Start',
          items: [
            { text: 'Documentation index', link: '/en/README' },
            { text: 'Project brief', link: '/en/00-project-brief' },
            { text: 'Product requirements', link: '/en/01-prd' },
          ],
        },
        {
          text: 'Architecture and lifecycle',
          items: [
            { text: 'Runtime architecture', link: '/en/02-architecture' },
            { text: 'Policy lifecycle', link: '/en/03-policy-lifecycle' },
          ],
        },
        {
          text: 'Reference',
          items: [
            { text: 'Policy DSL', link: '/en/04-policy-dsl' },
            { text: 'Behavioural events', link: '/en/05-event-spec' },
            { text: 'Compiler', link: '/en/06-compiler-spec' },
            { text: 'Embodiment interface', link: '/en/07-pet-bridge' },
            { text: 'Security and audit', link: '/en/08-security-and-audit' },
            { text: 'Report specification', link: '/en/10-report-spec' },
            { text: 'Glossary', link: '/en/glossary' },
          ],
        },
        {
          text: 'Project',
          items: [
            { text: 'Roadmap', link: '/en/09-mvp-roadmap' },
            { text: 'Contributing translations', link: '/en/contributing/translations' },
          ],
        },
      ],
    },

    socialLinks: [{ icon: 'github', link: 'https://github.com/hackmagic/AgentGate' }],

    docFooter: { prev: '上一页', next: '下一页' },
    outlineTitle: '本页目录',
    lastUpdatedText: '最后更新',
    returnToTopLabel: '回到顶部',
    sidebarMenuLabel: '目录',
    darkModeSwitchLabel: '主题',

    locales: {
      root: {
        label: '中文',
        lang: 'zh-CN',
        title: 'AgentGate',
        description: '把「AI 什么时候可以介入我电脑操作」写成可执行、可审计的边界策略。',
        themeConfig: {
          nav: [
            { text: '概览', link: '/00-project-brief' },
            { text: '架构', link: '/02-architecture' },
            { text: '策略 DSL', link: '/04-policy-dsl' },
          ],
          docFooter: { prev: '上一页', next: '下一页' },
          outlineTitle: '本页目录',
          lastUpdatedText: '最后更新',
          returnToTopLabel: '回到顶部',
          sidebarMenuLabel: '目录',
          darkModeSwitchLabel: '主题',
        },
      },
      en: {
        label: 'English',
        lang: 'en-US',
        link: '/en/',
        title: 'AgentGate',
        description: 'Write "when may AI act on my computer" as executable, auditable boundary policy.',
        themeConfig: {
          nav: [
            { text: 'Overview', link: '/en/00-project-brief' },
            { text: 'Architecture', link: '/en/02-architecture' },
            { text: 'Policy DSL', link: '/en/04-policy-dsl' },
          ],
          docFooter: { prev: 'Previous page', next: 'Next page' },
          outlineTitle: 'On this page',
          lastUpdatedText: 'Last updated',
          returnToTopLabel: 'Return to top',
          sidebarMenuLabel: 'Menu',
          darkModeSwitchLabel: 'Appearance',
        },
      },
    },
  },
});
