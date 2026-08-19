/* ===========================================================================
   MyNails — runtime enhancement
   No build step, and nothing here is load-bearing for reading the page: the
   words and the catalog are baked into index.html (by hand or by the visual
   builder in /static-admin/builder.html). This script only
     1. refreshes the data-driven lists and the announcement bar from
        /content/*.json, so a CMS edit shows up without re-saving the page,
     2. wires the waitlist form,
     3. adds the scroll-reveal motion.
   If a fetch fails — or JavaScript never runs — the baked-in page stands.
   Rendering logic lives in render.js (shared with the builder).
   =========================================================================== */

(function () {
  "use strict";

  // Opt in to JS-only styling (the scroll-reveal hide) only once this script
  // is actually running, so a blocked script can never strand content hidden.
  document.documentElement.classList.add("js");

  // Where content/ and media/ live, relative to this page.
  //
  // The default is the directory the page is served from, which is what lets
  // the same files work at user.github.io/repo/ and at a custom domain root.
  // That default is only right while every page sits at the same depth, and
  // the set pages do not: at /sets/amour it would look for the catalog in
  // /sets/content/ and paint every photograph from /sets/media/.
  //
  // So a page may name the site root itself, and the generated ones do. The
  // value is a path, not an origin — "/" for a domain root, "/repo/" for a
  // project page — and it is resolved against this page either way.
  var rootHint = document.querySelector('meta[name="site-root"]');
  var BASE = new URL(
    rootHint && rootHint.getAttribute("content") ? rootHint.getAttribute("content") : ".",
    document.baseURI
  );

  /** Resolve a CMS media path (`/media/uploads/x.jpg`) against the site base. */
  function asset(path) {
    if (!path) return "";
    if (/^(https?:)?\/\//.test(path) || path.startsWith("data:")) return path;
    return new URL(String(path).replace(/^\/+/, ""), BASE).href;
  }

  var get = window.PureRender.get;
  var isFilled = window.PureRender.isFilled;

  function fetchJSON(name) {
    return fetch(new URL("content/" + name, BASE).href, { cache: "no-cache" })
      .then(function (res) {
        if (!res.ok) throw new Error(name + ": HTTP " + res.status);
        return res.json();
      })
      .catch(function (err) {
        console.warn("[content]", err.message);
        return null;
      });
  }

  /* --- the notify form ---------------------------------------------------- */

  /**
   * Where a sign-up goes, in order of preference:
   *   1. the saastarter4-emdash backend, if this site has been told about one
   *   2. any third-party endpoint set in the CMS (Formspree and friends)
   *   3. the visitor's own mail app
   * This repo is public, so none of these can be a secret — the form id
   * identifies a form, it does not authorise anything.
   */
  /** A form's behaviour comes from its symbol's binding, stamped onto the
      markup at export: data-form (the backend form slug), data-endpoint (a
      third-party fallback), data-success (the message). Nothing global. */
  function submitEndpoint(content, form) {
    var backend = get(content, "site.backend") || {};
    var slug = form.dataset.form || backend.form;
    if (isFilled(backend.url) && isFilled(slug)) {
      return String(backend.url).replace(/\/+$/, "") + "/api/f/" + encodeURIComponent(slug);
    }
    return isFilled(form.dataset.endpoint) ? form.dataset.endpoint : "";
  }

  /* --- accounts -------------------------------------------------------------
     A second binding type, wired the same way the notify form is: the symbol
     says what it carries, the export stamps that onto the markup, and this
     reads the markup. Nothing global, and nothing here decides what an account
     may do — the node does, and it only ever hands a new one the default. */

  function apiRoot(content) {
    var backend = get(content, "site.backend") || {};
    return isFilled(backend.url)
      ? String(backend.url).replace(/\/+$/, "") + "/api"
      : "";
  }

  function post(url, body, method) {
    return fetch(url, {
      method: method || "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(function (response) {
      return response
        .json()
        .catch(function () {
          return {};
        })
        .then(function (parsed) {
          heldForDetails(parsed);
          return { ok: response.ok, body: parsed };
        });
    });
  }

  /* Which visitors a page is for, and where the others go. Read from the page
     itself, which the export stamped from the page's entry in the CMS. */
  function pageRule() {
    var read = function (name) {
      var node = document.querySelector('meta[name="' + name + '"]');
      return node ? node.getAttribute("content") : "";
    };
    return { needs: read("page-access"), to: read("page-redirect") };
  }

  /* Where to go once the sign-in lands.

     A page says where its visitors belong, but a caller may name somewhere
     else: the dashboard at /dynamic-admin sends people here in a popup and
     needs them back on the page that finishes the handshake, not on their
     account. Only a path on this site is honoured — an absolute URL in a query
     string is somebody else's redirect, and this is exactly the shape that gets
     used to bounce people off a trusted domain. */
  function nextTarget() {
    var raw = "";
    try {
      raw = new URLSearchParams(location.search).get("next") || "";
    } catch (error) {
      /* no URLSearchParams, or a malformed query — treated as unset */
    }
    return /^\/[^/\\]/.test(raw) ? raw : "";
  }

  /* --- passkeys -------------------------------------------------------------
     WebAuthn moves binary in and out of the browser, and the server speaks
     base64url, so the two conversions below are the whole adapter. Written out
     rather than pulled from a library: it is thirty lines, and a sign-in page
     is the last place to add a dependency loaded from someone else's CDN. */

  function fromB64(value) {
    var padded = String(value).replace(/-/g, "+").replace(/_/g, "/");
    var raw = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
    return Uint8Array.from(raw, function (c) {
      return c.charCodeAt(0);
    });
  }

  function toB64(buffer) {
    var bytes = new Uint8Array(buffer);
    var out = "";
    for (var i = 0; i < bytes.length; i += 1) out += String.fromCharCode(bytes[i]);
    return btoa(out).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function credentialJson(credential) {
    var r = credential.response;
    var out = {
      id: credential.id,
      rawId: toB64(credential.rawId),
      type: credential.type,
      clientExtensionResults: credential.getClientExtensionResults(),
      response: { clientDataJSON: toB64(r.clientDataJSON) },
    };
    if (r.attestationObject) {
      out.response.attestationObject = toB64(r.attestationObject);
      if (r.getTransports) out.response.transports = r.getTransports();
    } else {
      out.response.authenticatorData = toB64(r.authenticatorData);
      out.response.signature = toB64(r.signature);
      out.response.userHandle = r.userHandle ? toB64(r.userHandle) : undefined;
    }
    return out;
  }

  /* The node refuses everything an account with unfinished details asks for,
     and says so with one code. Wherever that arrives, the answer is the same
     page — the one with the questions on it — so it is handled once, here,
     rather than at each call site that might be the first to hit it.

     The account page itself is exempt, or landing there to answer the questions
     would bounce straight back to it. */
  function heldForDetails(body) {
    if (!body || body.code !== "profile_incomplete") return false;
    var here = location.pathname.replace(/\/+$/, "");
    if (/\/account$/.test(here) || /\/account\.html$/.test(here)) return false;
    location.assign("account");
    return true;
  }

  /**
   * A GET that prefers to be recognised but insists on getting through.
   *
   * The session cookie is what lets the node answer as "you" rather than as
   * "a stranger", so the first attempt sends it. But a credentialed request is
   * only readable if the server names this origin exactly — a reply of
   * `Access-Control-Allow-Origin: *` is a network error to the browser, not a
   * response, and the fetch rejects before any status is seen. That is the
   * shape a public read has when the endpoint is genuinely public and answers
   * everyone with a wildcard, and it took the contact form's fields down with
   * it: the page sat on "Loading the form…" for good.
   *
   * So a rejection is retried without credentials. Signed in, nothing changes.
   * Signed out — or blocked by a wildcard — the public answer still arrives,
   * which is the one the visitor was owed anyway.
   */
  function getJson(url) {
    var read = function (response) {
      return response.json().then(function (body) {
        heldForDetails(body);
        return { ok: response.ok, body: body };
      });
    };
    return fetch(url, { credentials: "include" }).then(read, function () {
      return fetch(url, { credentials: "omit" }).then(read);
    });
  }

  /* --- the account's own details -------------------------------------------
     A form bound to the account, drawn from the same definition the builder
     writes and the panel edits. Nothing here knows whose row it is: the server
     takes that from the session, so there is no id to send and none to forge. */

  function profileField(field, value) {
    var wrap = document.createElement("div");
    wrap.className = "account__field";

    var id = "profile-" + field.name;
    var label = document.createElement("label");
    label.setAttribute("for", id);
    label.textContent = field.label || field.name;
    if (field.required) label.textContent += " *";
    wrap.appendChild(label);

    var input;
    if (field.type === "textarea") {
      input = document.createElement("textarea");
      input.rows = 3;
    } else if (field.type === "select") {
      input = document.createElement("select");
      (field.options || []).forEach(function (choice) {
        var option = document.createElement("option");
        option.value = typeof choice === "string" ? choice : choice.value;
        option.textContent = typeof choice === "string" ? choice : choice.label;
        input.appendChild(option);
      });
    } else {
      input = document.createElement("input");
      input.type = field.type === "email" ? "email" : field.type === "tel" ? "tel" : "text";
    }

    input.id = id;
    input.name = field.name;
    input.className = "notify__input";

    /* The markup this replaces carried required and autocomplete; the drawn
       version carried neither, so the labels still read "Your email *" while
       the browser would happily post an empty subject and body. */
    if (field.required) input.required = true;
    var AUTOFILL = {
      email: "email",
      name: "name",
      first_name: "given-name",
      last_name: "family-name",
      phone: "tel",
      tel: "tel",
      address: "street-address",
      postcode: "postal-code",
      city: "address-level2",
      country: "country-name",
    };
    var token =
      AUTOFILL[field.name] ||
      (field.type === "email" ? "email" : field.type === "tel" ? "tel" : "");
    if (token) input.autocomplete = token;
    if (field.placeholder) input.placeholder = field.placeholder;
    else if (input.type === "email") input.placeholder = "you@example.com";
    if (value !== undefined && value !== null) input.value = value;

    /* A field the node answers itself, shown so it can be checked rather than
       asked for. Disabled rather than readonly so nothing is posted under this
       name at all — the node substitutes it either way, and sending a value it
       intends to discard only invites the question of whether it does. */
    if (field.readOnly) {
      input.value = field.value || input.value;
      input.disabled = true;
      input.className += " notify__input--locked";
      wrap.className += " account__field--locked";
    }

    wrap.appendChild(input);
    return wrap;
  }

  function applyProfile(root) {
    var host = document.querySelector("[data-profile]");
    if (!host) return;

    getJson(root + "/api/me/profile")
      .then(function (result) {
        if (!result.ok) return;
        var forms = (result.body && result.body.forms) || [];
        host.replaceChildren();
        if (!forms.length) return;
        host.hidden = false;

        forms.forEach(function (form) {
          var section = document.createElement("form");
          section.className = "account__profile";
          section.setAttribute("novalidate", "");
          section.onsubmit = function () {
            return false;
          };

          var heading = document.createElement("p");
          heading.className = "account__title";
          heading.textContent = form.name;
          section.appendChild(heading);

          // Said plainly, and only when it is true: the page is asking for
          // something before it can get on.
          if (!form.complete && form.requiredAtSignup) {
            var ask = document.createElement("p");
            ask.className = "account__note";
            ask.textContent = "We need these before your first order.";
            section.appendChild(ask);
          }

          form.fields.forEach(function (field) {
            section.appendChild(profileField(field, form.values[field.name]));
          });

          var note = document.createElement("p");
          note.className = "account__status";
          note.hidden = true;

          var save = document.createElement("button");
          save.type = "submit";
          save.className = "btn btn--solid";
          save.textContent = "Save";
          section.appendChild(save);
          section.appendChild(note);

          section.addEventListener("submit", function (event) {
            event.preventDefault();
            var values = {};
            form.fields.forEach(function (field) {
              if (field.readOnly) return;
              var input = section.querySelector('[name="' + field.name + '"]');
              if (input) values[field.name] = input.value;
            });
            say(note, "Saving…");
            post(root + "/api/me/profile", { slug: form.slug, values: values }, "PUT")
              .then(function (res) {
                if (!res.ok) {
                  say(note, res.body.error || "That did not save.", true);
                  return;
                }
                say(note, "Saved.");
              })
              .catch(function () {
                say(note, "Could not reach the server.", true);
              });
          });

          host.appendChild(section);
        });
      })
      .catch(function () {
        /* signed out, or forms are off — the section simply stays empty */
      });
  }

  function applyAccounts(content) {
    var root = apiRoot(content);
    // The whole document, not one symbol: the masthead has a sign-out on some
    // sites and the forms live on their own pages now.
    var scope = document;
    if (!root) return;


    function say(node, message, isError) {
      if (!node) return;
      node.textContent = message || "";
      node.hidden = !message;
      if (isError) node.setAttribute("data-error", "");
      else node.removeAttribute("data-error");
    }

    /* One attribute on <html> says which half of the page is drawn, and CSS
       does the drawing. The inline script in the head has already set it from
       the stored hint, so by the time this runs the page is usually already
       right and nothing moves; when the hint was wrong — a session that
       expired since — this is what corrects it. */
    function paint(session) {
      var signedIn = Boolean(session && session.user);
      var name = signedIn ? session.user.name || session.user.email : "";

      if (signedIn) document.documentElement.dataset.account = "in";
      else delete document.documentElement.dataset.account;

      document.querySelectorAll("[data-account-name]").forEach(function (node) {
        node.textContent = name;
      });
      // The heading is not set here: both are in the markup and CSS shows the
      // one that matches. Writing it from script is what made it flip.

      // Remembered so the next visit paints straight into the right state. A
      // display hint, never a credential: the server is asked every time.
      try {
        if (signedIn) localStorage.setItem("qa.account", name);
        else localStorage.removeItem("qa.account");
      } catch (error) {
        /* storage refused; the page still works, it just flashes once */
      }

      // The head made the same call from the stored hint before painting; this
      // is the one that knows, and it catches a hint that had gone stale.
      var rule = pageRule();
      var wrong =
        (rule.needs === "signed-in" && !signedIn) ||
        (rule.needs === "signed-out" && signedIn);
      if (wrong && rule.to) location.replace(nextTarget() || rule.to);
    }

    // The greeting is already filled, during parse, by the inline script beside
    // it. Nothing to do here until the session check comes back.

    function refresh() {
      return fetch(root + "/auth/get-session", { credentials: "include" })
        .then(function (response) {
          return response.ok ? response.json() : null;
        })
        .catch(function () {
          return null;
        })
        .then(paint);
    }

    /* One flow for signing in and signing up, because with a code they are the
       same act: an address we know gets in, one we do not gets an account at
       the lowest role. The form asks for the address, then swaps to asking for
       the code — no password anywhere, so there is none to lose. */
    scope.querySelectorAll('form[data-account]').forEach(function (form) {
      var note = form.querySelector("[data-account-note]");
      var emailField = form.querySelector('[name="email"]');
      var codeStep = form.querySelector("[data-account-step=\'code\']");
      var askStep = form.querySelector("[data-account-step=\'email\']");
      var codeField = form.querySelector('[name="otp"]');

      function show(step) {
        if (askStep) askStep.hidden = step !== "email";
        if (codeStep) codeStep.hidden = step !== "code";
        var focus = step === "code" ? codeField : emailField;
        if (focus) focus.focus();
      }

      form.addEventListener("submit", function (event) {
        event.preventDefault();
        var email = (emailField && emailField.value.trim()) || "";
        var code = (codeField && codeField.value.trim()) || "";

        // Second leg: a code is present, so this is the verification.
        if (code) {
          say(note, "Checking your code…");
          post(root + "/auth/sign-in/email-otp", { email: email, otp: code })
            .then(function (result) {
              if (!result.ok) {
                say(note, "That code did not match. Ask for another if it has expired.", true);
                return;
              }
              say(note, "");
              refresh();
            })
            .catch(function () {
              say(note, "Could not reach the server.", true);
            });
          return;
        }

        // First leg: ask for a code.
        if (!email) {
          say(note, "Enter the address to send the code to.", true);
          return;
        }
        say(note, "Sending a code to " + email + "…");
        post(root + "/auth/email-otp/send-verification-otp", {
          email: email,
          type: "sign-in",
        })
          .then(function (result) {
            if (!result.ok) {
              say(note, result.body.message || "Could not send a code.", true);
              return;
            }
            show("code");
            say(note, "Six digits are on their way to " + email + ".");
          })
          .catch(function () {
            say(note, "Could not reach the server.", true);
          });
      });

      var again = form.querySelector("[data-account-restart]");
      if (again) {
        again.addEventListener("click", function () {
          if (codeField) codeField.value = "";
          show("email");
          say(note, "");
        });
      }
    });

    /* What is already registered. A page that offers to add a passkey and then
       never mentions it again leaves someone unsure whether it worked, and
       unable to take one away when they lose the device. */
    var list = scope.querySelector("[data-passkey-list]");

    function drawPasskeys() {
      if (!list) return Promise.resolve();
      return getJson(root + "/auth/passkey/list-user-passkeys")
        .then(function (result) {
          var keys = result.ok && Array.isArray(result.body) ? result.body : [];
          list.replaceChildren();
          list.hidden = false;

          if (!keys.length) {
            var none = document.createElement("p");
            none.className = "account__note";
            none.textContent = "No passkeys on this account yet.";
            list.appendChild(none);
            return;
          }

          keys.forEach(function (key) {
            var row = document.createElement("div");
            row.className = "passkey";

            var text = document.createElement("div");
            text.className = "passkey__text";
            var name = document.createElement("p");
            name.className = "passkey__name";
            name.textContent = key.name || "Unnamed device";
            var when = document.createElement("p");
            when.className = "passkey__when";
            when.textContent = key.createdAt
              ? "Added " + new Date(key.createdAt).toLocaleDateString()
              : "";
            text.appendChild(name);
            text.appendChild(when);

            var remove = document.createElement("button");
            remove.type = "button";
            remove.className = "btn btn--ghost passkey__remove";
            remove.textContent = "Remove";
            remove.addEventListener("click", function () {
              remove.disabled = true;
              post(root + "/auth/passkey/delete-passkey", { id: key.id })
                .then(function (res) {
                  if (!res.ok) {
                    remove.disabled = false;
                    say(addNote, "That one could not be removed.", true);
                    return;
                  }
                  // Only from here. The device keeps its own copy, which is
                  // now a key to a lock that no longer exists.
                  drawPasskeys();
                })
                .catch(function () {
                  remove.disabled = false;
                });
            });

            row.appendChild(text);
            row.appendChild(remove);
            list.appendChild(row);
          });
        })
        .catch(function () {
          /* signed out, or the account has none — the list simply stays empty */
        });
    }

    /* Registering one. Only offered to someone already signed in, because a
       passkey is a second way into an account that has to exist first. */
    var add = scope.querySelector("[data-passkey-add]");
    var addNote = scope.querySelector("[data-passkey-note]");
    if (add) {
      if (!window.PublicKeyCredential) {
        add.hidden = true;
      } else {
        add.addEventListener("click", function () {
          say(addNote, "Ask your device to make one…");
          getJson(root + "/auth/passkey/generate-register-options")
            .then(function (result) {
              if (!result.ok) throw new Error("options");
              var options = result.body;
              options.challenge = fromB64(options.challenge);
              options.user.id = fromB64(options.user.id);
              (options.excludeCredentials || []).forEach(function (entry) {
                entry.id = fromB64(entry.id);
              });
              return navigator.credentials.create({ publicKey: options });
            })
            .then(function (credential) {
              // The credential goes in `response`; a name beside it is what
              // the panel lists it as later.
              return post(root + "/auth/passkey/verify-registration", {
                response: credentialJson(credential),
                name: navigator.platform || "This device",
              });
            })
            .then(function (result) {
              say(
                addNote,
                result.ok
                  ? "Done. You can use this device to sign in from now on."
                  : "That did not save. Try again.",
                !result.ok,
              );
              if (result.ok) drawPasskeys();
            })
            .catch(function (error) {
              // A refusal is the visitor changing their mind, not a fault.
              say(
                addNote,
                error && error.name === "NotAllowedError"
                  ? ""
                  : "This device could not make a passkey.",
                true,
              );
            });
        });
      }
    }

    /* Using one. No address typed: the device knows which accounts it holds
       for this site, which is the entire appeal. */
    var use = scope.querySelector("[data-passkey-use]");
    if (use) {
      var useNote = scope.querySelector("[data-passkey-note]") ||
        scope.querySelector("[data-account-note]");
      if (!window.PublicKeyCredential) {
        use.hidden = true;
      } else {
        use.addEventListener("click", function () {
          say(useNote, "Ask your device…");
          getJson(root + "/auth/passkey/generate-authenticate-options")
            .then(function (result) {
              if (!result.ok) throw new Error("options");
              var options = result.body;
              options.challenge = fromB64(options.challenge);
              (options.allowCredentials || []).forEach(function (entry) {
                entry.id = fromB64(entry.id);
              });
              return navigator.credentials.get({ publicKey: options });
            })
            .then(function (credential) {
              return post(root + "/auth/passkey/verify-authentication", {
                response: credentialJson(credential),
              });
            })
            .then(function (result) {
              if (!result.ok) {
                say(useNote, "That passkey was not recognised here.", true);
                return;
              }
              say(useNote, "");
              refresh();
            })
            .catch(function (error) {
              say(
                useNote,
                error && error.name === "NotAllowedError"
                  ? ""
                  : "No passkey was offered for this site.",
                true,
              );
            });
        });
      }
    }

    var out = scope.querySelector("[data-account-sign-out]");
    if (out) {
      out.addEventListener("click", function () {
        post(root + "/auth/sign-out", {}).then(function () {
          paint(null);
        });
      });
    }

    refresh();
    drawPasskeys();
    applyProfile(root.replace(/\/api$/, ""));
  }

  /* --- forms the node draws -------------------------------------------------
     A form marked `data-form-fields` has no fields in the markup. It asks the
     node what to show and draws that, which is what lets one contact form ask a
     stranger for their address and a member for nothing: the decision is the
     node's, taken from the session, and the page has no rule of its own to get
     wrong. A designer changes the questions in the panel and this follows. */

  function renderFormFields(content, form) {
    var root = apiRoot(content);
    var slug = form.dataset.form || (get(content, "site.backend") || {}).form;
    if (!root || !slug) return;

    var host = form.querySelector("[data-form-fields]") || form;
    var status = form.querySelector(".notify__status");

    getJson(root + "/public/forms/" + encodeURIComponent(slug))
      .then(function (result) {
        if (!result.ok) {
          if (result.body && result.body.code === "sign_in_required") {
            say(status, "Sign in to use this form.", "error");
            form.hidden = true;
          }
          return;
        }
        var fields = (result.body && result.body.fields) || [];
        host.replaceChildren();
        fields.forEach(function (field) {
          host.appendChild(profileField(field, field.value));
        });
        // Put back after the fields, so the button stays last in the tab order.
        var button = form.querySelector("button[type='submit']");
        if (button && host === form) form.appendChild(button);
        form.dataset.rendered = "1";
      })
      .catch(function () {
        /* leave whatever the markup already had — a form that cannot reach the
           node is better as the plain one than as nothing */
      });
  }

  function applyForms(content) {
    var mailto = get(content, "site.contact.email");

    document.querySelectorAll("[data-form-fields]").forEach(function (host) {
      var form = host.closest("form");
      if (form) renderFormFields(content, form);
    });

    document.querySelectorAll("form[data-form], form.notify").forEach(function (form) {
      var action = submitEndpoint(content, form);
      var success = form.dataset.success || "You are on the list. Watch your inbox.";

      // Delegated: renderFormFields() calls replaceChildren() on the field
      // host, so anything bound to an individual input is thrown away with it.
      form.addEventListener("input", function (event) {
        if (event.target && event.target.hasAttribute("aria-invalid")) {
          clearInvalid(event.target);
        }
      });
      form.addEventListener("submit", function (event) {
        event.preventDefault();

        var status = form.querySelector(".notify__status");
        // Absent on a form the node fills the address into, which is the point
        // of this whole mechanism — so its absence is a shape, not a fault.
        var input = form.querySelector('input[type="email"]:not([disabled])');
        var email = input ? input.value.trim() : "";

        if (input && (!input.checkValidity() || !email)) {
          say(status, "That email address is not complete. Check it and try again.", "error");
          markInvalid(input, status);
          input.focus();
          return;
        }

        // Whatever else the node draws, it still has to be filled in.
        var blank = null;
        form.querySelectorAll("[required]:not([disabled])").forEach(function (node) {
          if (!blank && !String(node.value || "").trim()) blank = node;
        });
        if (blank) {
          say(status, "Something above is still empty.", "error");
          markInvalid(blank, status);
          blank.focus();
          return;
        }

        // No form endpoint configured yet: hand the visitor to their mail app
        // rather than silently dropping the address.
        if (!action) {
          if (!isFilled(mailto)) {
            say(status, "The list is not open yet. Try again shortly.", "error");
            return;
          }
          window.location.href =
            "mailto:" +
            mailto +
            "?subject=" +
            encodeURIComponent("Opening notice") +
            "&body=" +
            encodeURIComponent("Please add " + email + " to the list.");
          say(status, "Opening your mail app to finish.", "ok");
          return;
        }

        var button = form.querySelector("button[type='submit']");
        if (button) {
          button.disabled = true;
          button.setAttribute("aria-busy", "true");
        }
        say(status, "Sending…", "pending");

        // Sent as FormData on purpose: multipart/form-data is a CORS-safe
        // content type, so the browser skips the preflight round trip that
        // application/json would force on every submission.
        fetch(action, {
          method: "POST",
          headers: { Accept: "application/json" },
          // So the node recognises a signed-in sender and can answer the fields
          // it said it would. A stranger sends no cookie and gets the form they
          // were shown, which is the same request either way.
          credentials: "include",
          body: new FormData(form),
        })
          .then(function (res) {
            return res.json().then(
              function (body) {
                return { ok: res.ok, body: body };
              },
              function () {
                return { ok: res.ok, body: {} };
              }
            );
          })
          .then(function (result) {
            // The backend reports per-field problems rather than a bare failure.
            var fieldError = (result.body.errors || [])[0];
            if (fieldError) {
              say(status, fieldError.message, "error");
              markInvalid(
                form.querySelector('[name="' + fieldError.field + '"]'),
                status
              );
              return;
            }
            if (!result.ok || result.body.success === false) {
              say(status, result.body.message || "That did not send. Try again.", "error");
              return;
            }
            form.querySelectorAll("[aria-invalid]").forEach(clearInvalid);
            form.reset();
            // The form has done its job; the fields go and the confirmation
            // takes their place, so nobody submits the same address twice.
            form.dataset.done = "1";
            say(status, result.body.message || success, "ok");
          })
          .catch(function () {
            say(status, "That did not send. Try again, or email us directly.", "error");
          })
          .finally(function () {
            if (button) {
              button.disabled = false;
              button.removeAttribute("aria-busy");
            }
          });
      });
    });
  }

  /* An error that only prints a sentence under a form leaves the reader to
     find the field it is about. These mark it, and point the field's
     description at the sentence, so a screen reader reads both together. */
  function markInvalid(field, status) {
    if (!field) return;
    field.setAttribute("aria-invalid", "true");
    if (status && status.id) field.setAttribute("aria-describedby", status.id);
  }

  function clearInvalid(field) {
    if (!field) return;
    field.removeAttribute("aria-invalid");
    field.removeAttribute("aria-describedby");
  }

  function say(node, message, state) {
    if (!node) return;
    node.textContent = message;
    if (state) {
      node.dataset.state = state;
    } else {
      delete node.dataset.state;
    }
  }

  /* --- scroll reveal ------------------------------------------------------ */

  function reveal(nodes) {
    if (
      !("IntersectionObserver" in window) ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      nodes.forEach(function (node) {
        node.classList.add("is-revealed");
      });
      return;
    }

    // Anything still unobserved after a beat gets shown anyway, so a card can
    // never be stranded invisible (print, a stalled observer, a headless render).
    var failsafe = setTimeout(function () {
      nodes.forEach(function (node) {
        node.classList.add("is-revealed");
      });
    }, 2500);

    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-revealed");
          observer.unobserve(entry.target);
        });
      },
      { rootMargin: "0px 0px -10%" }
    );

    nodes.forEach(function (node) {
      observer.observe(node);
    });

    window.addEventListener("beforeprint", function () {
      clearTimeout(failsafe);
      nodes.forEach(function (node) {
        node.classList.add("is-revealed");
      });
    });
  }

  /* --- the hand in the room -------------------------------------------------
     Everything around the hand says it is an object under a lamp: a cast
     shadow, a lit rim on every tile, a vignette that puts the light on it. And
     then it never moved, which is what makes a composition feel plastered —
     not the absence of animation but the absence of a point of view.

     So the hand turns. Two angles, written to the panel; the stylesheet decides
     what they mean and what follows them. The shadow on the wall behind goes
     the same way and further, the pool of light goes the other way, and the
     type does not move at all — it is printed on the page rather than standing
     in the room. Reading depth out of that is not a decision anyone makes
     consciously; it is just how looking works.

     The damping is here rather than in a CSS transition. A transition would be
     chasing a target that is itself chasing the cursor, so the two lags
     compound and letting go becomes a second, differently-timed motion. One
     spring, run frame by frame: it follows while you move, runs down when you
     stop, and the loop ends when there is nothing left to move. */

  function liftHero() {
    var hero = document.querySelector(".hero[data-hero-panel]");
    var stage = hero && hero.querySelector(".hero__stage");
    if (!stage) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    // Degrees at the edge of the panel. Past about seven the hand stops
    // turning and starts fanning: these are photographs, not models, and a
    // flat thing rotated too far reads as a flat thing rotated.
    var TURN = 5.6;
    var PITCH = 3.4;
    // A thirteenth of the remaining distance per frame — heavy enough that the
    // hand trails your cursor with some weight, light enough that it is never
    // a beat behind it.
    var EASE = 0.078;

    var want = { turn: 0, pitch: 0 };
    var at = { turn: 0, pitch: 0 };
    var frame = 0;
    // A finger is only listened to while it is held down: on a touch screen a
    // pointermove without a pointerdown is a scroll going past, and turning the
    // hand for that would fight the page.
    var held = false;

    function step() {
      frame = 0;
      at.turn += (want.turn - at.turn) * EASE;
      at.pitch += (want.pitch - at.pitch) * EASE;
      hero.style.setProperty("--hand-turn", at.turn.toFixed(3));
      hero.style.setProperty("--hand-pitch", at.pitch.toFixed(3));
      if (Math.abs(want.turn - at.turn) > 0.003 || Math.abs(want.pitch - at.pitch) > 0.003) {
        run();
      }
    }

    function run() {
      if (!frame) frame = window.requestAnimationFrame(step);
    }

    function aim(event) {
      var box = hero.getBoundingClientRect();
      if (!box.width || !box.height) return;
      var nx = Math.max(-1, Math.min(1, ((event.clientX - box.left) / box.width) * 2 - 1));
      var ny = Math.max(-1, Math.min(1, ((event.clientY - box.top) / box.height) * 2 - 1));
      // Turning *toward* the pointer: a positive rotateY takes the right edge
      // away from the viewer, so facing right is a negative angle.
      want.turn = -nx * TURN;
      want.pitch = ny * PITCH;
      run();
    }

    function rest() {
      want.turn = 0;
      want.pitch = 0;
      run();
    }

    hero.addEventListener(
      "pointermove",
      function (event) {
        if (event.pointerType === "touch" && !held) return;
        aim(event);
      },
      { passive: true }
    );

    /* A drag across the hand already goes to the next set. While it is being
       dragged the hand should also go with the finger — pushing an object and
       watching it turn is the only version of this that a touch screen can
       have, and it is a better one than a cursor gets. */
    stage.addEventListener(
      "pointerdown",
      function (event) {
        if (event.pointerType === "touch") held = true;
      },
      { passive: true }
    );

    ["pointerup", "pointercancel"].forEach(function (name) {
      window.addEventListener(
        name,
        function () {
          if (!held) return;
          held = false;
          rest();
        },
        { passive: true }
      );
    });

    hero.addEventListener("pointerleave", rest, { passive: true });
    // Scrolling the hero out from under a stationary cursor does not fire
    // pointerleave, and a hand left turned at the top of a page you have left
    // is a hand stuck mid-gesture.
    window.addEventListener(
      "scroll",
      function () {
        if (held) return;
        if (hero.getBoundingClientRect().bottom < 0 && (want.turn || want.pitch)) rest();
      },
      { passive: true }
    );
  }

  /* --- turning a tile toward whoever is reaching for it ----------------------
     The seven cards and the two studio flat-lays are photographs of objects, so
     they answer a cursor the way an object would: the tile turns to face it and
     the picture inside the tile moves against its own frame. Two planes at
     different rates is the whole of it.

     Delegated to the two lists rather than bound per card, because the cards
     are re-rendered from the CMS after this runs and a listener on a node that
     has since been replaced is a listener on nothing. */

  function tiltTiles() {
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    var TURN = 4.6;
    var PITCH = 3.4;

    document.querySelectorAll(".set-grid, .pieces, .case__trays").forEach(function (list) {
      var open = null;

      function clear() {
        if (!open) return;
        open.style.removeProperty("--turn");
        open.style.removeProperty("--pitch");
        open = null;
      }

      list.addEventListener(
        "pointermove",
        function (event) {
          var tile = event.target.closest && event.target.closest(".set, .piece, .tray");
          if (!tile) {
            clear();
            return;
          }
          if (tile !== open) clear();
          open = tile;
          var box = tile.getBoundingClientRect();
          if (!box.width || !box.height) return;
          var nx = ((event.clientX - box.left) / box.width) * 2 - 1;
          var ny = ((event.clientY - box.top) / box.height) * 2 - 1;
          tile.style.setProperty("--turn", (-nx * TURN).toFixed(2));
          tile.style.setProperty("--pitch", (ny * PITCH).toFixed(2));
        },
        { passive: true }
      );

      list.addEventListener("pointerleave", clear, { passive: true });
    });
  }

  /* --- trying a set on ------------------------------------------------------
     The hero is one photograph of a bare hand with every set laid over it. A
     chip swaps which layer is showing and re-declares the panel's three
     colours; nothing here is needed to read the page, and with JavaScript off
     the hand simply keeps wearing set one. */

  function applyHero(content) {
    var panel = document.querySelector("[data-hero-panel]");
    if (!panel) return;

    var sets = get(content, "catalog.items");
    var chips = Array.prototype.slice.call(panel.querySelectorAll(".chip"));
    var layers = Array.prototype.slice.call(panel.querySelectorAll(".hero__layer"));
    var rail = panel.querySelector(".tryon__rail");
    if (!Array.isArray(sets) || !chips.length) return;

    /* A key may be bound more than once — the set's index is printed in the
       try-on counter and again as the engraving behind the hand — so each key
       maps to a list, not to whichever node happened to come last. */
    var slots = {};
    panel.querySelectorAll("[data-hero]").forEach(function (node) {
      var key = node.getAttribute("data-hero");
      (slots[key] = slots[key] || []).push(node);
    });

    function put(key, value) {
      (slots[key] || []).forEach(function (node) {
        node.textContent = value;
      });
    }

    var total = String(sets.length).padStart(2, "0");
    var current = -1;

    function pad(n) {
      return String(n).padStart(2, "0");
    }

    function wear(index, scrollIntoView) {
      var set = sets[index];
      if (!set || index === current) return;
      current = index;

      ["wash", "shade", "deep", "ground", "glow", "lume"].forEach(function (key) {
        if (!isFilled(set[key])) return;
        panel.style.setProperty("--" + key, set[key]);
      });

      /* Only the three lit values go on the root, so the ribbon and the
         masthead — which sit above the hero rather than inside it — wear the
         set too. Not --wash/--shade/--deep: those are the cream palette's
         names, and writing a pale wash onto the root overwrote the lit
         ground's own --wash, which is what the skip link's colour is taken
         from. Painting a rectangle's tokens onto the document is how a theme
         gets quietly undone. */
      ["ground", "glow", "lume"].forEach(function (key) {
        if (isFilled(set[key])) {
          document.documentElement.style.setProperty("--" + key, set[key]);
        }
      });

      // Re-keying the headline restarts its entrance, so the name arrives
      // rather than swapping character for character.
      (slots.title || []).forEach(function (node) {
        node.textContent = set.title || "";
        node.style.animation = "none";
        void node.offsetWidth;
        node.style.animation = "";
      });
      put("eyebrow", "Handmade press-on · Set " + pad(index + 1) + " of " + total);
      put("tagline", set.tagline || "");
      put("finish", set.finish || "");
      put("shape", set.shape || "");
      put("price", set.price || "");
      put("index", pad(index + 1));
      // `total` rather than the raw count: the eyebrow beside it already reads
      // "Set 05 of 07", and the counter was rendering "05 / 7" against it.
      put("total", total);

      layers.forEach(function (layer, i) {
        layer.classList.toggle("is-on", i === index);
      });

      chips.forEach(function (chip, i) {
        var on = i === index;
        chip.setAttribute("aria-current", on ? "true" : "false");
        var button = chip.querySelector("button");
        if (button) button.setAttribute("aria-pressed", on ? "true" : "false");
      });

      if (scrollIntoView && rail && chips[index]) {
        var chip = chips[index];
        rail.scrollTo({
          left: chip.offsetLeft - (rail.clientWidth - chip.offsetWidth) / 2,
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
            ? "auto"
            : "smooth",
        });
      }
    }

    /* --- the parade -------------------------------------------------------
       Left alone, the hero tries the seven on by itself — the one thing a
       static page could never do, and the fastest way to say "each of these
       is a different set" without asking for a single click. It is a
       courtesy, not a carousel: it waits while the visitor is anywhere near
       the rail or holding the hand, it stops for good the moment they choose
       a set themselves, it does not run off-screen or in a hidden tab, and it
       never starts at all for anyone who asked for less motion. */
    var HOLD = 5200;
    var paradeTimer = 0;
    var paradeDone = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var heroSeen = true;
    // True while a cursor or the keyboard focus is on the rail. Held as its
    // own flag because the tab-hidden and off-screen pauses also end in
    // scheduleParade(), and coming back to the tab must not restart the
    // parade under a cursor that never moved.
    var engaged = false;

    panel.style.setProperty("--hold", HOLD + "ms");

    function pauseParade() {
      if (paradeTimer) {
        clearTimeout(paradeTimer);
        paradeTimer = 0;
      }
      // The fill under the worn tile goes with the timer it was tracking;
      // a bar that keeps filling while nothing is scheduled is a lie.
      panel.classList.remove("is-parading");
    }

    function stopParade() {
      paradeDone = true;
      pauseParade();
      panel.classList.remove("is-parading");
    }

    function scheduleParade() {
      if (paradeDone || engaged || document.hidden || !heroSeen) return;
      pauseParade();
      panel.classList.add("is-parading");
      paradeTimer = window.setTimeout(function () {
        paradeTimer = 0;
        wear((current + 1) % chips.length, true);
        scheduleParade();
      }, HOLD);
    }

    chips.forEach(function (chip, index) {
      var button = chip.querySelector(".chip__button");
      if (!button) return;
      button.setAttribute("aria-pressed", index === 0 ? "true" : "false");
      button.addEventListener("click", function (event) {
        // Let a middle-click, a ctrl/cmd-click or a shift-click through: the
        // href is the set's own page and someone doing that means it.
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        stopParade();
        wear(index, true);
      });
    });

    // Left and right walk the rail once a chip has focus.
    if (rail) {
      rail.addEventListener("keydown", function (event) {
        var step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
        if (!step) return;
        event.preventDefault();
        stopParade();
        var next = (current + step + chips.length) % chips.length;
        wear(next, true);
        var button = chips[next].querySelector(".chip__button");
        if (button) button.focus();
      });

      // Reaching for the rail — with a cursor, a finger or the tab key — is
      // the visitor taking over. The parade waits, and comes back only after
      // they have left it alone again.
      rail.addEventListener(
        "pointerenter",
        function () {
          engaged = true;
          pauseParade();
        },
        { passive: true }
      );
      rail.addEventListener(
        "pointerleave",
        function () {
          engaged = false;
          scheduleParade();
        },
        { passive: true }
      );
      rail.addEventListener("pointerdown", stopParade, { passive: true });
      rail.addEventListener("focusin", function () {
        engaged = true;
        pauseParade();
      });
      rail.addEventListener("focusout", function (event) {
        if (rail.contains(event.relatedTarget)) return;
        engaged = false;
        scheduleParade();
      });
    }

    // A drag across the hand goes to the next set, which is how anyone holding
    // a phone expects a stack of photographs to behave.
    var stage = panel.querySelector(".hero__stage");
    if (stage) {
      var from = null;
      stage.addEventListener("pointerdown", function (event) {
        from = event.clientX;
        // Holding the hand pauses the parade; it resumes on release unless
        // the hold turned out to be a swipe, which stops it for good below.
        pauseParade();
      });
      // Ended on the window, not the stage, exactly like the tilt above: a
      // press that ends off the stage never fires pointerup here, and a
      // vertical scroll that starts on the hand ends in pointercancel with no
      // pointerup at all. Either way the gesture is over — `from` must clear
      // (or a later unrelated release reads as a swipe) and the parade must
      // come back rather than staying paused for good.
      ["pointerup", "pointercancel"].forEach(function (name) {
        window.addEventListener(
          name,
          function (event) {
            if (from === null) return;
            var moved = name === "pointerup" ? event.clientX - from : 0;
            from = null;
            if (Math.abs(moved) < 44) {
              scheduleParade();
              return;
            }
            stopParade();
            wear(
              (current + (moved < 0 ? 1 : -1) + chips.length) % chips.length,
              true
            );
          },
          { passive: true }
        );
      });
    }

    // Off-screen or in a background tab the parade holds still: sets should
    // not have come and gone while nobody was looking.
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(
        function (entries) {
          heroSeen = Boolean(entries[0] && entries[0].isIntersecting);
          if (heroSeen) {
            scheduleParade();
          } else {
            pauseParade();
          }
        },
        { threshold: 0.25 }
      ).observe(panel);
    }

    document.addEventListener("visibilitychange", function () {
      if (document.hidden) {
        pauseParade();
      } else {
        scheduleParade();
      }
    });

    current = -1;
    wear(0, false);
    scheduleParade();
  }

  /* --- the mobile dock ------------------------------------------------------
     Arrives once the hero is behind you, and marks whichever section is
     closest to the top of the screen. */

  function applyDock() {
    var dock = document.querySelector(".dock");
    if (!dock) return;

    var links = Array.prototype.slice.call(dock.querySelectorAll(".dock__link"));
    if (!links.length) return;

    var pending = 0;

    function update() {
      pending = 0;
      dock.classList.toggle("is-shown", window.scrollY > 140);

      var line = window.innerHeight * 0.42;
      var best = 0;
      var nearest = -Infinity;

      links.forEach(function (link, index) {
        var id = link.getAttribute("data-dock-target");
        if (!id) return;
        var section = document.getElementById(id);
        if (!section) return;
        var top = section.getBoundingClientRect().top;
        if (top <= line && top > nearest) {
          nearest = top;
          best = index;
        }
      });

      dock.style.setProperty("--i", best);
      links.forEach(function (link, index) {
        if (index === best) link.setAttribute("aria-current", "location");
        else link.removeAttribute("aria-current");
      });
    }

    function schedule() {
      if (!pending) pending = window.requestAnimationFrame(update);
    }

    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule, { passive: true });
  }

  /* --- the ribbon's height --------------------------------------------------
     The masthead floats over the hero, which starts directly under the nail
     ribbon. CSS guesses the ribbon's height from the nail size; once the
     images have laid out, this replaces the guess with the measurement. */

  function measureRibbon() {
    var ribbon = document.querySelector(".ribbon--top");
    if (!ribbon) return;

    var set = function () {
      /* The ribbon's bottom edge, not its height: the announcement bar sits
         above it, and the masthead that floats over the hero is offset by this
         value. Measuring only the strip left the header 37-55px high in the
         ribbon's captions once the bar was switched on. */
      var rect = ribbon.getBoundingClientRect();
      var bottom = Math.round(rect.bottom + window.scrollY);
      if (bottom > 0) document.documentElement.style.setProperty("--ribbon-h", bottom + "px");
    };

    set();
    window.addEventListener("resize", set, { passive: true });
    if (document.readyState !== "complete") window.addEventListener("load", set);
  }

  /* --- stopping the nail strips ---------------------------------------------
     Two marquees run for ever on the landing page. The only way to stop them
     was to hold a cursor over one, which is not discoverable and, on a touch
     screen, latches paused after a tap instead. WCAG 2.2.2 asks for a control.

     The button is built here rather than baked into the markup so it cannot
     exist as a dead control when this script does not run — and it is not
     built at all for a visitor who has already asked for less motion, because
     for them the animation is off and a pause button would be a lie. */
  function pauseRibbons() {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    document.querySelectorAll(".ribbon").forEach(function (ribbon) {
      var track = ribbon.querySelector(".ribbon__track");
      if (!track) return;

      var button = document.createElement("button");
      button.type = "button";
      button.className = "ribbon__pause";
      button.setAttribute("aria-pressed", "false");
      button.textContent = "Pause";

      button.addEventListener("click", function () {
        var paused = ribbon.hasAttribute("data-paused");
        if (paused) ribbon.removeAttribute("data-paused");
        else ribbon.setAttribute("data-paused", "");
        button.setAttribute("aria-pressed", paused ? "false" : "true");
        button.textContent = paused ? "Pause" : "Play";
      });

      // A sibling of the track, never a child: the bottom ribbon's track is
      // aria-hidden, and a control inside it would be hidden with it.
      track.insertAdjacentElement("afterend", button);
    });
  }

  /* --- go ----------------------------------------------------------------- */

  // Content files are discovered from the bindings: site and pages always,
  // plus whatever roots the symbols' Content sources name (catalog.items ->
  // catalog.json, craft.steps -> craft.json, …). Adding a source-bound symbol
  // needs no change here.
  // Chrome first: neither of these needs the content, and both decide where
  // things sit on the screen — they should not wait on a network round trip.
  measureRibbon();
  pauseRibbons();
  applyDock();
  // Both read the markup that is already on the page and neither waits on the
  // catalog: the hand is baked in, and the tilt is delegated to the two lists
  // rather than to the cards inside them.
  liftHero();
  tiltTiles();

  fetchJSON("symbols.json").then(function (manifest) {
    var symbolEntries = {};
    var roots = { site: true, pages: true };

    (((manifest || {}).symbols) || []).forEach(function (entry) {
      if (!entry || !entry.id) return;
      symbolEntries[entry.id] = entry;
      if (isFilled(entry.source)) roots[String(entry.source).split(".")[0]] = true;
    });

    var names = Object.keys(roots);
    return Promise.all(
      names.map(function (name) {
        return fetchJSON(name + ".json");
      })
    ).then(function (parts) {
      var content = { symbolEntries: symbolEntries };
      names.forEach(function (name, index) {
        content[name] = parts[index] || {};
      });
      window.PureRender.bindAll(document, content, { asset: asset });
      applyForms(content);
      applyAccounts(content);
      applyHero(content);

      /* The seven and the studio's two both stand up off the page as they
         arrive. The stagger restarts at each list rather than running across
         both, so a row of three is a row of three: counting in document order
         is enough for that, because siblings are always contiguous in it. */
      var risers = document.querySelectorAll(".set, .piece, .tray");
      var list = null;
      var seat = 0;
      risers.forEach(function (node) {
        if (node.parentNode !== list) {
          list = node.parentNode;
          seat = 0;
        }
        node.style.setProperty("--reveal-delay", (seat % 3) * 70 + "ms");
        seat += 1;
      });
      reveal(risers);
    });
  }).catch(function (error) {
    /* Nothing above is load-bearing for reading the page — except that the
       cards are held at opacity 0 until something says to show them. If any of
       it throws, that something has to be this. */
    console.warn("[content]", error && error.message);
    document.querySelectorAll(".set, .piece, .tray").forEach(function (node) {
      node.classList.add("is-revealed");
    });
  });
})();
