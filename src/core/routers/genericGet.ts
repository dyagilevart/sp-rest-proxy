import * as fs from 'fs';
import * as path from 'path';
import * as request from 'request';
import { Request, Response, NextFunction } from 'express';

import { BasicRouter } from '../BasicRouter';
import { IProxyContext, IProxySettings } from '../interfaces';

export class GetRouter extends BasicRouter {

  constructor(context: IProxyContext, settings: IProxySettings) {
    super(context, settings);
  }

  public router = (req: Request, res: Response, _next?: NextFunction) => {
    let staticIndexUrl = '/index.html';
    if (req.url !== '/') {
      staticIndexUrl = req.url;
    } else {
      let pageContent = String(fs.readFileSync(path.join(this.settings.staticRoot, staticIndexUrl)));
      pageContent = pageContent.replace('##proxyVersion#', this.settings.metadata.version);
      res.send(pageContent);
      return;
    }
    if (req.url === '/config') {
      const response = {
        siteUrl: this.ctx.siteUrl,
        username: (this.ctx.authOptions as any).username || 'Add-In'
      };
      res.json(response);
      return;
    }
    if (fs.existsSync(path.join(this.settings.staticRoot, staticIndexUrl))) {
      res.sendFile(path.join(this.settings.staticRoot, staticIndexUrl));
      return;
    }
    // Static resources from SharePoint
    let endpointUrl = this.util.buildEndpointUrl(req.originalUrl);
    this.spr = this.util.getCachedRequest(this.spr);
    this.logger.info('\nGET: ' + endpointUrl);

    const requestHeadersPass: any = {};
    const ignoreHeaders = [ 'host', 'referer', 'origin', 'accept-encoding', 'connection', 'if-none-match' ];
    Object.keys(req.headers).forEach(prop => {
      if (ignoreHeaders.indexOf(prop.toLowerCase()) === -1) {
        if (prop.toLowerCase() === 'accept' && req.headers[prop] !== '*/*') {
          requestHeadersPass.Accept = req.headers[prop];
        } else if (prop.toLowerCase() === 'content-type') {
          requestHeadersPass['Content-Type'] = req.headers[prop];
        } else {
          requestHeadersPass[prop] = req.headers[prop];
        }
      }
    });
    this.logger.verbose('\nHeaders:', JSON.stringify(requestHeadersPass, null, 2));
    const advanced = {
      json: false,
      processData: false,
      encoding: null
    };
    const ext = endpointUrl.split('?')[0].split('.').pop().toLowerCase();
    if (['js', 'css', 'aspx', 'css', 'html', 'json', 'axd'].indexOf(ext) !== -1) {
      delete advanced.encoding;
      requestHeadersPass.Accept = 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8';
    }
    if (endpointUrl.indexOf('/ScriptResource.axd') !== -1) {
      const axdUrlArr = endpointUrl.split('/ScriptResource.axd');
      endpointUrl = `${axdUrlArr[0].split('/').splice(0, 3).join('/')}/ScriptResource.axd${axdUrlArr[1]}`;
      request.get({
        uri: endpointUrl,
        agent: this.util.isUrlHttps(endpointUrl) ? this.settings.agent : undefined
      }).pipe(res);
      return;
    }
    this.spr.get(endpointUrl, {
      headers: requestHeadersPass,
      ...advanced as any,
      agent: this.util.isUrlHttps(endpointUrl) ? this.settings.agent : undefined
    })
      .then(r => {
        this.logger.verbose(r.statusCode, r.body);
        res.status(r.statusCode);
        res.contentType(r.headers['content-type'] || '');
        res.send(r.body);
      })
      .catch(err => {
        res.status(err.statusCode >= 100 && err.statusCode < 600 ? err.statusCode : 500);
        if (err.response && err.response.body) {
          res.json(err.response.body);
        } else {
          res.send(err.message);
        }
      });
  }

}