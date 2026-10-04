import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

describe('Android APK Branding & Splash Screen Verification', () => {
  it('1. Existing MM2D splash background is preserved and accessible', () => {
    const splashAsset = path.resolve('src/assets/mm2d_splash.png');
    const splashPublic = path.resolve('public/mm2d_splash.png');

    assert.ok(fs.existsSync(splashAsset), 'src/assets/mm2d_splash.png must exist');
    assert.ok(fs.existsSync(splashPublic), 'public/mm2d_splash.png must exist');

    const statAsset = fs.statSync(splashAsset);
    assert.ok(statAsset.size > 100000, 'Splash background image must be a valid high-res asset');
  });

  it('2. MM2D launcher icon assets exist across all required Android resolutions', () => {
    const logo1024 = path.resolve('public/mm2d_logo.png');
    assert.ok(fs.existsSync(logo1024), 'High-res 1024x1024 mm2d_logo.png must exist');

    const expectedResolutions = [
      'android/app/src/main/res/mipmap-mdpi/ic_launcher.png',
      'android/app/src/main/res/mipmap-hdpi/ic_launcher.png',
      'android/app/src/main/res/mipmap-xhdpi/ic_launcher.png',
      'android/app/src/main/res/mipmap-xxhdpi/ic_launcher.png',
      'android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png',
      'android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml',
      'android/app/src/main/res/mipmap-anydpi-v26/ic_launcher_round.xml',
      'public/icon-192.png',
      'public/icon-512.png',
      'public/icon-maskable-512.png',
    ];

    for (const relPath of expectedResolutions) {
      const fullPath = path.resolve(relPath);
      assert.ok(fs.existsSync(fullPath), `Launcher icon asset must exist: ${relPath}`);
      const stat = fs.statSync(fullPath);
      assert.ok(stat.size > 0, `Asset ${relPath} must not be empty`);
    }
  });

  it('3. Web App Manifest and HTML head correctly configure MM2D branding and launcher icons', () => {
    const manifestPath = path.resolve('public/manifest.json');
    assert.ok(fs.existsSync(manifestPath), 'public/manifest.json must exist');

    const manifestContent = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    assert.equal(manifestContent.name, 'MM2D - Thai Market AI');
    assert.equal(manifestContent.short_name, 'MM2D');
    assert.equal(manifestContent.theme_color, '#070B14');
    assert.equal(manifestContent.background_color, '#070B14');
    assert.ok(manifestContent.icons.length >= 4, 'Manifest must have multi-density icons');

    const indexPath = path.resolve('index.html');
    const indexHtml = fs.readFileSync(indexPath, 'utf-8');
    assert.ok(indexHtml.includes('manifest.json'), 'index.html must link to manifest.json');
    assert.ok(indexHtml.includes('theme-color'), 'index.html must define theme-color');
    assert.ok(indexHtml.includes('apple-touch-icon'), 'index.html must link apple-touch-icon');
  });

  it('4. SplashScreen component preserves background, removes separate overlay logo, and renders loading animation', () => {
    const splashCode = fs.readFileSync(path.resolve('src/components/SplashScreen.tsx'), 'utf-8');

    // Must use the existing splash background
    assert.ok(splashCode.includes('mm2dSplashImg'), 'Must import mm2d_splash.png background');
    assert.ok(!splashCode.includes('mm2dLogoImg'), 'Must NOT place the large MM2D logo as a separate splash logo');

    // Must include the glowing cyan/blue progress bar
    assert.ok(splashCode.includes('border-cyan-400'), 'Must include glowing cyan/blue progress bar');
    assert.ok(splashCode.includes('mm2d-progress-sweep'), 'Must include animated sweep effect');

    // Must include Loading... text and animated dots
    assert.ok(splashCode.includes('Loading...'), 'Must include Loading... text');
    assert.ok(splashCode.includes('mm2d-dot-pulse'), 'Must include animated pulsing dots');

    // Must include tagline from reference
    assert.ok(
      splashCode.includes('Live Market Intelligence for Smarter Insights'),
      'Must include the reference tagline'
    );
  });

  it('5. GitHub Actions Android APK build workflow is configured', () => {
    const workflowPath = path.resolve('.github/workflows/android-build.yml');
    assert.ok(fs.existsSync(workflowPath), 'Android APK build workflow must exist');

    const workflowContent = fs.readFileSync(workflowPath, 'utf-8');
    assert.ok(workflowContent.includes('MM2D Android APK Build'), 'Workflow must have correct name');
    assert.ok(workflowContent.includes('mm2d_logo.png'), 'Workflow must verify launcher icon');
    assert.ok(workflowContent.includes('mm2d_splash.png'), 'Workflow must verify splash background');
  });
});
