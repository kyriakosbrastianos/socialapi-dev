/* -*- Mode: JavaScript; tab-width: 4; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim: set ts=2 et sw=2 tw=80: */
/* ***** BEGIN LICENSE BLOCK *****
 * Version: MPL 1.1/GPL 2.0/LGPL 2.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is Open Web Apps for Firefox.
 *
 * The Initial Developer of the Original Code is The Mozilla Foundation.
 * Portions created by the Initial Developer are Copyright (C) 2011
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *  Michael Hanson <mhanson@mozilla.com>
 *	Anant Narayanan <anant@kix.in>
 *	Mark Hammond <mhammond@mozilla.com>
 *	Shane Caraveo <scaraveo@mozilla.com>
 *
 * Alternatively, the contents of this file may be used under the terms of
 * either the GNU General Public License Version 2 or later (the "GPL"), or
 * the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
 * in which case the provisions of the GPL or the LGPL are applicable instead
 * of those above. If you wish to allow use of your version of this file only
 * under the terms of either the GPL or the LGPL, and not to allow others to
 * use your version of this file under the terms of the MPL, indicate your
 * decision by deleting the provisions above and replace them with the notice
 * and other provisions required by the GPL or the LGPL. If you do not delete
 * the provisions above, a recipient may use your version of this file under
 * the terms of any one of the MPL, the GPL or the LGPL.
 *
 * ***** END LICENSE BLOCK ***** */

const {classes: Cc, interfaces: Ci, utils: Cu, resources: Cr, manager: Cm} = Components;

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://socialdev/lib/provider.js");
Cu.import("resource://socialdev/lib/manifestDB.jsm");
Cu.import("resource://socialdev/lib/defaultServices.jsm");
Cu.import("resource://socialdev/lib/console.js");

const NS_XUL = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";
const FRECENCY = 100;


/**
 * manifestRegistry is our internal api for registering manfist files that
   contain data for various services. It holds a registry of installed activity
   handlers, their mediators, and allows for invoking a mediator for installed
   services.
 */
function ManifestRegistry() {
  Services.obs.addObserver(this, "document-element-inserted", true);
  //Services.obs.addObserver(this, "origin-manifest-registered", true);
  //Services.obs.addObserver(this, "origin-manifest-unregistered", true);
  // later we can hook into webapp installs
  //Services.obs.addObserver(this, "openwebapp-installed", true);
  //Services.obs.addObserver(this, "openwebapp-uninstalled", true);

  installBuiltins();
}

const manifestRegistryClassID = Components.ID("{8d764216-d779-214f-8da0-80e211d759eb}");
const manifestRegistryCID = "@mozilla.org/manifestRegistry;1";

ManifestRegistry.prototype = {
  classID: manifestRegistryClassID,
  contractID: manifestRegistryCID,
  QueryInterface: XPCOMUtils.generateQI([Ci.nsISupportsWeakReference, Ci.nsIObserver]),

  _getUsefulness: function manifestRegistry_findMeABetterName(url, loginHost) {
    let hosturl = Services.io.newURI(url, null, null);
    loginHost = loginHost || hosturl.scheme+"://"+hosturl.host;
    return {
      hasLogin: hasLogin(loginHost),
      frecency: frecencyForUrl(hosturl.host)
    }
  },

  askUserInstall: function(aWindow, aCallback) {
    // BUG 732263 remember if the user says no, use that as a check in
    // discoverActivity so we bypass a lot of work.
    let nId = "manifest-ask-install";
    let nBox = aWindow.gBrowser.getNotificationBox();
    let notification = nBox.getNotificationWithValue(nId);

    // Check that we aren't already displaying our notification
    if (!notification) {
      let message = "This site supports additional functionality for Firefox, would you like to install it?";

      buttons = [{
        label: "Yes",
        accessKey: null,
        callback: function () {
          aWindow.setTimeout(function () {
            aCallback();
          }, 0);
        }
      }];
      nBox.appendNotification(message, nId, null,
                  nBox.PRIORITY_INFO_MEDIUM, buttons);
    }
  },

  importManifest: function manifestRegistry_importManifest(aDocument, location, manifest, userRequestedInstall) {
    //console.log("got manifest "+JSON.stringify(manifest));

    let registry = this;
    function installManifest() {
      manifest.origin = location; // make this an origin
      ManifestDB.put(location, manifest);
      // XXX notification of installation
    }

    if (userRequestedInstall) {
      installManifest();
    }
    else {
      let info = this._getUsefulness(location);
      if (!info.hasLogin && info.frecency < FRECENCY) {
        //console.log("this site simply is not important, skip it");
        return;
      }
      // we reached here because the user has a login or visits this site
      // often, so we want to offer an install to the user
      //console.log("installing "+location+ " because "+JSON.stringify(info));
      // prompt user for install
      var xulWindow = aDocument.defaultView.QueryInterface(Ci.nsIInterfaceRequestor)
                     .getInterface(Ci.nsIWebNavigation)
                     .QueryInterface(Ci.nsIDocShellTreeItem)
                     .rootTreeItem
                     .QueryInterface(Ci.nsIInterfaceRequestor)
                     .getInterface(Ci.nsIDOMWindow);
      this.askUserInstall(xulWindow, installManifest)
      return;
    }
  },

  loadManifest: function manifestRegistry_loadManifest(aDocument, url, userRequestedInstall) {
    // BUG 732264 error and edge case handling
    let xhr = Cc["@mozilla.org/xmlextras/xmlhttprequest;1"].createInstance(Ci.nsIXMLHttpRequest);
    xhr.open('GET', url, true);
    let registry = this;
    xhr.onreadystatechange = function(aEvt) {
      if (xhr.readyState == 4) {
        if (xhr.status == 200 || xhr.status == 0) {
          //console.log("got response "+xhr.responseText);
          try {
            registry.importManifest(aDocument, url, JSON.parse(xhr.responseText), userRequestedInstall);
          } catch(e) {
            console.log("importManifest: "+e);
          }
        } else {
          console.log("got status "+xhr.status);
        }
      }
    };
    //console.log("fetch "+url);
    xhr.send(null);
  },

  discoverManifest: function manifestRegistry_discoverManifest(aDocument, aData) {
    // BUG 732266 this is probably heavy weight, is there a better way to watch for
    // links in documents?

    // TODO determine whether or not we actually want to load this
    // manifest.
    // 1. is it already loaded, skip it, we'll check it for updates another
    //    way
    // 2. does the user have a login for the site, if so, load it
    // 3. does the fecency for the site warrent loading the manifest and
    //    offering to the user?
    let links = aDocument.getElementsByTagName('link');
    for (let index=0; index < links.length; index++) {
      let link = links[index];
      if (link.getAttribute('rel') == 'manifest' &&
          link.getAttribute('type') == 'text/json') {
        //console.log("found manifest url "+link.getAttribute('href'));
        let baseUrl = aDocument.defaultView.location.href;
        let url = Services.io.newURI(baseUrl, null, null).resolve(link.getAttribute('href'));
        //console.log("base "+baseUrl+" resolved to "+url);
        ManifestDB.get(url, function(item) {
          if (!item) {
            this.loadManifest(aDocument, url);
          }
        });
      }
    }
  },

  /**
   * observer
   *
   * reset our mediators if an app is installed or uninstalled
   */
  observe: function manifestRegistry_observe(aSubject, aTopic, aData) {
    if (aTopic == "document-element-inserted") {
      if (!aSubject.defaultView)
        return;
      //console.log("new document "+aSubject.defaultView.location);
      this.discoverManifest(aSubject, aData);
      return;
    }
  },

  /**
   * get
   *
   * Return the mediator instance handling this activity, create one if one
   * does not exist.
   *
   * @param  jsobject activity
   * @return MediatorPanel instance
   */
  get: function manifestRegistry_get(cb) {
    ManifestDB.iterate(function(key, manifest) {
      cb(new SocialProvider(manifest));
    });
  }
};

//const components = [manifestRegistry];
//const NSGetFactory = XPCOMUtils.generateNSGetFactory(components);
const manifestRegistryService = new ManifestRegistry();

function manifestRegistry() {
  return manifestRegistryService;
}
const EXPORTED_SYMBOLS = ["manifestRegistry"];