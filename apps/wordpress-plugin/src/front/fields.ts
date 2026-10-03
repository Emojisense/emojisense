import "@emojisense/web-component/textarea.css";
import { readConfig } from "../lib/config.js";
import { type FieldsConfig, setUpFields } from "../lib/fields.js";
import "./fields.scss";

setUpFields(document, readConfig<FieldsConfig>());
