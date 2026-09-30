/**
 * GFJ-08: an employer's own website and logo, found from the board's stored
 * data and (in the owner-run script) its homepage.
 */
import { describe, it, expect } from 'vitest';
import {
  domainNamesEmployer,
  employerNameTokens,
  homepageNamesEmployer,
  isNonEmployerHost,
  parseHomepageFacts,
  registrableDomain,
  websiteCandidates,
} from '@/lib/company-web-identity';

describe('domains', () => {
  it('reads the registrable domain', () => {
    expect(registrableDomain('careers.lifestance.com')).toBe('lifestance.com');
    expect(registrableDomain('www.example.co.uk')).toBe('example.co.uk');
    expect(registrableDomain('localhost')).toBeNull();
  });

  it('never treats an ATS, job board or social host as an employer site', () => {
    for (const host of ['job-boards.greenhouse.io', 'davita.wd1.myworkdayjobs.com', 'jobs.lever.co', 'jobs.smartrecruiters.com', 'televerohealth.bamboohr.com', 'apply.workable.com', 'www.linkedin.com', 'bit.ly']) {
      expect(isNonEmployerHost(host), host).toBe(true);
    }
    expect(isNonEmployerHost('careers.davita.com')).toBe(false);
  });

  it('matches a domain only when it names the employer', () => {
    expect(employerNameTokens('LifeStance Health, Inc.')).toEqual(['life', 'stance']);
    expect(domainNamesEmployer('lifestance.com', 'LifeStance Health')).toBe(true);
    expect(domainNamesEmployer('davita.com', 'DaVita Kidney Care')).toBe(true);
    expect(domainNamesEmployer('solmentalhealth.com', 'Sol Mental Health')).toBe(true);
    expect(domainNamesEmployer('sol.com', 'Sol Mental Health')).toBe(false);
    expect(domainNamesEmployer('aetna.com', 'LifeStance Health')).toBe(false);
  });
});

describe('websiteCandidates', () => {
  it('prefers an apply link on the employer domain, then description links and e-mail domains', () => {
    const candidates = websiteCandidates('DaVita', [
      { applyLink: 'https://davita.wd1.myworkdayjobs.com/en-US/DKC_External/job/x_R1', description: 'Email careers@davita.com. See https://www.davita.com/about.' },
      { applyLink: 'https://careers.davita.com/job/123', description: null },
    ]);
    expect(candidates).toEqual([
      { website: 'https://davita.com', domain: 'davita.com', evidence: 'apply_link', source: 'https://careers.davita.com/job/123' },
    ]);
  });

  it('reads a www link from a description and keeps the www host', () => {
    const candidates = websiteCandidates('MedElite', [
      { applyLink: 'https://job-boards.greenhouse.io/medelitellc/jobs/5408840008', description: 'Learn more at www.medelitegrp.com. Apply today.' },
    ]);
    expect(candidates[0]).toMatchObject({ website: 'https://www.medelitegrp.com', evidence: 'description_link' });
  });

  it('ignores domains that name someone else and ATS hosts', () => {
    expect(websiteCandidates('LifeStance Health', [
      { applyLink: 'https://lifestance.wd5.myworkdayjobs.com/x', description: 'We accept Aetna (www.aetna.com). EEO info at www.eeoc.gov.' },
    ])).toEqual([]);
  });
});

describe('parseHomepageFacts', () => {
  const base = 'https://www.example.org/';

  it('prefers the JSON-LD Organization logo', () => {
    const html = `<html><head><title>Example Health | Home</title>
      <script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebSite"},{"@type":"Organization","name":"Example Health","logo":{"@type":"ImageObject","url":"/img/logo.png"}}]}</script>
      <link rel="apple-touch-icon" href="/apple.png"></head></html>`;
    expect(parseHomepageFacts(html, base)).toEqual({ siteName: 'Example Health | Home', logoUrl: 'https://www.example.org/img/logo.png', logoSource: 'json_ld' });
  });

  it('falls back to the apple-touch-icon, then a large icon; never an SVG or a small favicon', () => {
    const apple = '<title>X</title><link rel="apple-touch-icon" sizes="180x180" href="https://cdn.example.org/apple.png">';
    expect(parseHomepageFacts(apple, base).logoSource).toBe('apple_touch_icon');
    const icons = '<meta property="og:site_name" content="Example Health"><link rel="icon" sizes="32x32" href="/f32.png"><link rel="icon" sizes="192x192" href="/f192.png"><link rel="icon" href="/logo.svg">';
    expect(parseHomepageFacts(icons, base)).toEqual({ siteName: 'Example Health', logoUrl: 'https://www.example.org/f192.png', logoSource: 'icon' });
    expect(parseHomepageFacts('<link rel="icon" sizes="32x32" href="/f32.png">', base).logoUrl).toBeNull();
  });

  it('homepageNamesEmployer checks the site name', () => {
    expect(homepageNamesEmployer('LifeStance Health | Mental Health Care', 'LifeStance Health')).toBe(true);
    expect(homepageNamesEmployer('Domain for sale', 'LifeStance Health')).toBe(false);
    expect(homepageNamesEmployer(null, 'LifeStance Health')).toBe(false);
  });
});
