const { withAndroidManifest, withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const NETSEC_XML = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="true">
    <trust-anchors>
      <certificates src="system" />
    </trust-anchors>
  </base-config>
</network-security-config>
`;

module.exports = function withCleartext(config) {
  config = withAndroidManifest(config, (cfg) => {
    const app = cfg.modResults.manifest.application[0];
    app.$['android:usesCleartextTraffic'] = 'true';
    app.$['android:networkSecurityConfig'] = '@xml/network_security_config';
    return cfg;
  });

  config = withDangerousMod(config, [
    'android',
    async (cfg) => {
      const resXml = path.join(
        cfg.modRequest.projectRoot,
        'android',
        'app',
        'src',
        'main',
        'res',
        'xml'
      );
      fs.mkdirSync(resXml, { recursive: true });
      fs.writeFileSync(
        path.join(resXml, 'network_security_config.xml'),
        NETSEC_XML
      );
      return cfg;
    },
  ]);

  return config;
};
